module.exports = getExports();

const webPush = require('web-push');

const privateDetails = require('../privateDetails');
const General = require('./General');
const errorService = require('../scripts/ErrorService');

const { objKeysToCamelCase } = General;
const { ErrorWithClientMessage } = errorService;

let db;

webPush.setVapidDetails(
	`mailto:${privateDetails.webPush.contactEmail}`,
	privateDetails.webPush.vapid.publicKey,
	privateDetails.webPush.vapid.privateKey
);

function init(serverVariables) {
	db = serverVariables.db;
}

async function saveSubscription(userId, subscription) {
	const { endpoint, expirationTime, keys } = subscription,
		subscriptionIds = await db('subscriptions')
			.insert({
				user_id: userId,
				endpoint,
				expires: expirationTime,
				keys_p256dh: keys.p256dh,
				keys_auth: keys.auth
			})
			.returning('id');
	if (!subscriptionIds.length) {
		throw new ErrorWithClientMessage({
			tech: 'Unable to save subscription to database',
			sameForClient: true
		});
	}
	return subscriptionIds[0];
}

async function removeSubscription(userId, subscription) {
	const numRows = await db('subscriptions')
		.where({
			user_id: userId,
			endpoint: subscription.endpoint
		})
		.del();
	if (numRows === 0) {
		throw new ErrorWithClientMessage({
			tech: 'Unable to remove subscription from database',
			sameForClient: true
		});
	}
	return true;
}

async function removeSubscriptionsWithEndpoint(endpoint) {
	await db('subscriptions')
		.where({ endpoint })
		.del();
}

async function findSubscriptionsForUserWithId(userId) {
	const subscriptions = await db('subscriptions')
		.where({ user_id: userId })
		.select('*');
	return subscriptions.length ? objKeysToCamelCase(subscriptions) : [];
}

function constructSubscriptionObject(subscription) {
	const {
		endpoint,
		expires: expirationTime,
		keysP256Dh: p256dh,
		keysAuth: auth
	} = subscription;

	return {
		endpoint,
		expirationTime,
		keys: {
			p256dh,
			auth
		}
	};
}

function sendNotification(subscriptionObj, payload) {
	return webPush.sendNotification(subscriptionObj, JSON.stringify(payload))
		.catch(error => {
			if (error.statusCode === 404 || error.statusCode === 410) {
				console.log('Subscription has expired or is no longer valid -', error);
				removeSubscriptionsWithEndpoint(subscriptionObj.endpoint);
			} else {
				console.error('Error sending notification -', error);
			}
		});
}

async function findSubscriptionWithEndpoint(endpoint) {
	const subscriptions = await db('subscriptions')
		.where({ endpoint: endpoint })
		.select('*');
	return subscriptions.length ? objKeysToCamelCase(subscriptions[0]) : null;
}

function getExports() {
	return {
		init,
		saveSubscription,
		removeSubscription,
		removeSubscriptionsWithEndpoint,
		findSubscriptionsForUserWithId,
		constructSubscriptionObject,
		sendNotification,
		findSubscriptionWithEndpoint
	};
}