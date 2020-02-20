module.exports = getExports();

const config = require('../config');
const General = require('./General');
const Notifications = require('./Notifications');
const Users = require('./Users');
const errorService = require('../scripts/ErrorService');

const { objKeysToCamelCase, generateUniqueIdForTableColumn } = General;
const { ErrorWithClientMessage } = errorService;

let db;

function init(serverVariables) {
	db = serverVariables.db;
}

async function saveOffer(dbTransaction, sellerId, offer) {
	const { description, dealValue, validFrom, validFromCustom, validUntil, numUses } = offer,
		offerIds = await dbTransaction('offers')
			.insert({
				seller_id: sellerId,
				description,
				deal_value: dealValue,
				starts: validFromCustom ? new Date(validFrom) : new Date(),
				expires: new Date(validUntil),
				uses_per_customer: numUses,
				status: validFromCustom ? 'pending' : 'active'
			})
			.returning('offer_id');
	if (!offerIds.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add offer to database transaction',
			client: 'Unable to save offer to database'
		});
	}
	return offerIds[0];
}

async function createOfferInstances(offer, sellerId, offerId) {
	let instances = [];
	const customers = await db('users')
		.whereNot({ user_id: sellerId })
		.select('user_id');
	const customerIds = customers.map(customer => customer.user_id);

	for (let customerId of customerIds) {
		const [ uniqueIdForCustomer, uniqueIdForSeller ] = await Promise.all([
			generateUniqueIdForCustomer(),
			generateUniqueIdForSeller()
		]);

		if (uniqueIdForCustomer == null) {
			throw new ErrorWithClientMessage({
				tech: `Failed to generate unique ID for customer with ID ${customerId}`,
				client: 'Error generating unique ID for offer instance'
			});
		} else if (uniqueIdForSeller == null) {
			throw new ErrorWithClientMessage({
				tech: `Failed to generate unique ID for seller with ID ${sellerId}`,
				client: 'Error generating unique ID for offer instance'
			});
		}

		const instance = {
			offerId,
			customerId,
			uniqueIdForCustomer,
			uniqueIdForSeller,
			remainingUses: offer.numUses
		};
		instances.push(instance);
	}

	return instances;
}

async function generateUniqueIdForCustomer() {
	return generateUniqueIdForOfferInstance('customer');
}

async function generateUniqueIdForSeller() {
	return generateUniqueIdForOfferInstance('seller');
}

async function generateUniqueIdForOfferInstance(type) {
	let columnName;

	switch (type) {
		case 'customer':
			columnName = 'unique_id_for_customer';
			break;

		case 'seller':
			columnName = 'unique_id_for_seller';
			break;

		default:
			return null;
	}

	return generateUniqueIdForTableColumn('offer_instances', columnName);
}

async function saveOfferInstances(dbTransaction, instances) {
	const insertData = instances.map(instance => {
		const { offerId, customerId, uniqueIdForCustomer, uniqueIdForSeller, remainingUses } = instance;
		return {
			offer_id: offerId,
			customer_id: customerId,
			unique_id_for_customer: uniqueIdForCustomer,
			unique_id_for_seller: uniqueIdForSeller,
			remaining_uses: remainingUses
		};
	});

	const instanceIds = await dbTransaction('offer_instances')
		.insert(insertData)
		.returning('instance_id');

	if (!instanceIds.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add any offer instances to database transaction',
			client: 'Unable to save offer instances to database'
		});
	}

	return instanceIds;
}

async function findOfferWithId(offerId) {
	const offers = await db('offers')
		.where({ offer_id: offerId })
		.select('*');
	return offers.length ? objKeysToCamelCase(offers[0]) : null;
}

async function findOfferInstanceForCustomer(offerInstanceIdForCustomer) {
	const offerInstances = await db('offer_instances')
		.where({ unique_id_for_customer: offerInstanceIdForCustomer })
		.select('*');
	return offerInstances.length ? objKeysToCamelCase(offerInstances[0]) : null;
}

async function findOfferInstanceForSeller(offerInstanceIdForSeller) {
	const offerInstances = await db('offer_instances')
		.where({ unique_id_for_seller: offerInstanceIdForSeller })
		.select('*');
	return offerInstances.length ? objKeysToCamelCase(offerInstances[0]) : null;
}

function formatOfferForClient(offer) {
	const { description, dealValue, expires } = offer;
	return {
		description,
		dealValue,
		validUntil: Dates.formatDateForDisplay(expires)
	};
}

async function removeOffer(offerId) {
	const numRows = await db('offers')
		.where({ offer_id: offerId })
		.del();
	return numRows > 0;
}

async function deactivateOffer(offerId) {
	const offers = await db('offers')
		.update({ status: 'deactivated' })
		.where({ offer_id: offerId })
		.returning('*');
	if (!offers.length) {
		throw new ErrorWithClientMessage({
			tech: `Failed to deactivate offer with ID ${offerId}`,
			client: 'Unable to deactivate offer'
		});
	}

	await db('offer_schedule')
		.where({ offer_id: offerId })
		.del();

	return true;
}

async function updateOfferDescription(offerId, newDescription) {
	const offers = await db('offers')
		.update({ description: newDescription })
		.where({ offer_id: offerId })
		.returning('*');
	return offers.length;
}

async function findActiveOffersFromUser(userId) {
	const offers = await db('offers')
		.where({ seller_id: userId })
		.andWhere(function() {
			this.where({ status: 'active' }).orWhere({ status: 'pending' })
		})
		.orderBy('offer_id')
		.select('*');
	return offers.length ? objKeysToCamelCase(offers) : [];
}

async function saveScheduleForOffer(offer, offerId) {
	const { validFrom, validFromCustom, validUntil } = offer;
	let rows;

	if (validFromCustom) {
		rows = await db('offer_schedule')
			.insert({
				offer_id: offerId,
				timestamp: new Date(validFrom),
				action: 'activate'
			})
			.returning('*');
		if (!rows.length) {
			throw new ErrorWithClientMessage({
				tech: 'Failed to add offer activation scheduling to database transaction',
				client: 'Unable to save offer scheduling to database'
			});
		}
	}

	rows = await db('offer_schedule')
		.insert({
			offer_id: offerId,
			timestamp: new Date(validUntil),
			action: 'deactivate'
		})
		.returning('*');
	if (!rows.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add offer deactivation scheduling to database transaction',
			client: 'Unable to save offer scheduling to database'
		});
	}
}

async function activateOffer(offerId) {
	const offers = await db('offers')
		.update({ status: 'active' })
		.where({ offer_id: offerId })
		.returning('*');
	if (!offers.length) {
		throw Error(`Failed to activate offer with ID ${offerId}`);
	}

	await db('offer_schedule')
		.where({
			offer_id: offerId,
			action: 'activate'
		})
		.del();

	return true;
}

async function restoreOfferSchedule() {
	const offerScheduleRows = await db('offer_schedule').select('*'),
		offerScheduleItems = objKeysToCamelCase(offerScheduleRows);
	let offers = [];

	for (let item of offerScheduleItems) {
		const { offerId, timestamp, action } = item,
			existingOffer = offers.find(offer => offer.id === offerId),
			offer = existingOffer || { id: offerId },
			date = new Date(timestamp);

		if (action === 'activate') {
			offer.activationDate = date;
		} else if (action === 'deactivate') {
			offer.deactivationDate = date;
		}

		if (!existingOffer) offers.push(offer);
	}

	let activationCalls = [],
		i = 0;

	while (i < offers.length) {
		const offer = offers[i],
			{ id, activationDate, deactivationDate } = offer,
			shouldHaveBeenActivated = (
				activationDate != null && activationDate.getTime() <= Date.now()
			),
			shouldHaveBeenDeactivated = (
				deactivationDate != null && deactivationDate.getTime() <= Date.now()
			);

		if (shouldHaveBeenDeactivated) {
			activationCalls.push(() => deactivateOffer(id));
			offer.deactivationDate = null;
		} else if (shouldHaveBeenActivated) {
			activationCalls.push(() => activateOffer(id));
			offer.activationDate = null;
		}

		if (!offer.activationDate && !offer.deactivationDate) {
			offers.splice(i, 1);
		} else {
			i++;
		}
	}

	await Promise.all(activationCalls.map(call => call()));
	scheduleService.scheduleExistingOffers(offers);
}

function checkOfferIsValidAndActive(offer) {
	const { offerId } = offer;
	if (offer == null) {
		throw new ErrorWithClientMessage({
			tech: `Offer for ID ${offerId} not found`,
			client: 'Sorry, we could not find information on this offer'
		});
	} else if (offer.status === 'pending') {
		throw new ErrorWithClientMessage({
			tech: `Offer with ID ${offerId} is pending activation`,
			client: 'Sorry, this offer is not active yet'
		});
	} else if (offer.status !== 'active') {
		throw new ErrorWithClientMessage({
			tech: `Offer with ID ${offerId} is inactive`,
			client: 'Sorry, this offer is inactive'
		});
	}
	return true;
}

async function customerActivateOffer(offer, offerInstance) {
	const { instanceId } = offerInstance,
		instances = await db('offer_instances')
			.update({ activated: true })
			.where({ instance_id: instanceId })
			.returning('*');
	if (!instances.length) {
		throw new ErrorWithClientMessage({
			tech: `Failed to activate offer instance with ID ${instanceId}`,
			client: 'A database error occurred'
		});
	}
	return true;
}

function buildServeOfferQrCodeUrl(uniqueIdForSeller) {
	const redeemUrl = `${config.frontendRoot}/redeemOffer/${uniqueIdForSeller}/`;
	return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${redeemUrl}`;
}

async function saveOfferInstanceUse(dbTransaction, offerId, offerInstanceId) {
	const offer = await findOfferWithId(offerId),
		decrementRemainingUses = offer.usesPerCustomer > 0;

	const instances = await dbTransaction('offer_instances')
		.where({ instance_id: offerInstanceId })
		.decrement('remaining_uses', decrementRemainingUses ? 1 : 0)
		.increment('current_uses', 1)
		.returning('remaining_uses');

	if (!instances.length) {
		throw new ErrorWithClientMessage({
			tech: `Failed to save use for offer instance with ID ${offerInstanceId}`,
			client: 'A database error occurred'
		});
	}

	return instances[0].remaining_uses;
}

async function sendOfferNotifications(offerInstances) {
	let promiseChain = Promise.resolve();

	for (let offerInstance of offerInstances) {
		let { customerId } = offerInstance,
			offer = await findOfferWithId(offerInstance.offerId);
		if (offer == null) continue;
		let seller = await Users.findUserWithId(offer.sellerId);
		if (seller == null) continue;
		let subscriptions = await Notifications.findSubscriptionsForUserWithId(customerId);

		for (let subscription of subscriptions) {
			promiseChain = promiseChain.then(() => {
				let subscriptionObj = Notifications.constructSubscriptionObject(subscription),
					payload = constructOfferNotificationPayload(offer, seller, offerInstance);
				return Notifications.sendNotification(subscriptionObj, payload);
			});
		}
	}

	return promiseChain;
}

function constructOfferNotificationPayload(offer, seller, offerInstance) {
	const { description, dealValue, expires } = offer,
		sellerName = seller.userName,
		{ uniqueIdForCustomer } = offerInstance;
	return {
		sellerName,
		description,
		dealValue,
		validUntil: expires,
		url: `${config.frontendRoot}/serveOffer/${uniqueIdForCustomer}/`
	};
}

function getExports() {
	return {
		init,
		saveOffer,
		createOfferInstances,
		generateUniqueIdForCustomer,
		generateUniqueIdForSeller,
		generateUniqueIdForOfferInstance,
		saveOfferInstances,
		findOfferWithId,
		findOfferInstanceForCustomer,
		findOfferInstanceForSeller,
		formatOfferForClient,
		removeOffer,
		deactivateOffer,
		updateOfferDescription,
		findActiveOffersFromUser,
		saveScheduleForOffer,
		activateOffer,
		restoreOfferSchedule,
		checkOfferIsValidAndActive,
		customerActivateOffer,
		buildServeOfferQrCodeUrl,
		saveOfferInstanceUse,
		sendOfferNotifications,
		constructOfferNotificationPayload
	};
}