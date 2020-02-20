const scheduler = require('node-schedule');
const errorService = require('./ErrorService');

class ScheduleService {
	constructor() {
		this.activationFunction = null;
		this.deactivationFunction = null;
		this.schedule = {
			offers: []
		};
	}

	setOfferActivationFunctions(activationFunction, deactivationFunction) {
		this.activationFunction = activationFunction;
		this.deactivationFunction = deactivationFunction;
	}

	scheduleOffer(offer) {
		const { id, activationDate, deactivationDate } = offer,
			activationJob = activationDate ? this.scheduleActivation(id, activationDate) : null,
			deactivationJob = this.scheduleDeactivation(id, deactivationDate);

		this.schedule.offers.push({
			id,
			activationJob,
			deactivationJob
		});
	}

	scheduleNewOffer(offer, offerId) {
		const { validFrom, validFromCustom, validUntil } = offer;
		this.scheduleOffer({
			id: offerId,
			activationDate: validFromCustom ? new Date(validFrom) : null,
			deactivationDate: new Date(validUntil)
		});
	}

	scheduleExistingOffers(offers) {
		for (let offer of offers) {
			this.scheduleOffer(offer);
		}
	}

	scheduleActivation(offerId, date) {
		return scheduler.scheduleJob(
			date,
			() => this.activateOffer(offerId, true)
		);
	}

	scheduleDeactivation(offerId, date) {
		return scheduler.scheduleJob(
			date,
			() => this.deactivateOffer(offerId)
		);
	}

	async activateOffer(offerId, onSchedule = false) {
		try {
			const { schedule, activationFunction } = this,
				offerScheduleEntry = schedule.offers.find(offer => offer.id  === offerId);
			if (!offerScheduleEntry) {
				throw Error(`Could not find schedule entry for offer with ID ${offerId}`);
			}
			const { activationJob } = offerScheduleEntry;
			if (activationJob) {
				if (!onSchedule) activationJob.cancel();
				offerScheduleEntry.activationJob = null;
			}
			await this.activationFunction(offerId);
		} catch (error) {
			errorService.handleError(null, error);
		}
	}

	async deactivateOffer(offerId, onSchedule = false) {
		try {
			const { schedule, deactivationFunction } = this,
				offerScheduleIndex = schedule.offers.findIndex(offer => offer.id === offerId);
			if (offerScheduleIndex < 0) {
				throw Error(`Could not find schedule index for offer with ID ${offerId}`);
			}
			const { activationJob, deactivationJob } = schedule.offers[offerScheduleIndex];
			if (!onSchedule) {
				if (activationJob) activationJob.cancel();
				if (deactivationJob) deactivationJob.cancel();
			}
			schedule.offers.splice(offerScheduleIndex, 1);
			await this.deactivationFunction(offerId);
		} catch (error) {
			errorService.handleError(null, error);
		}
	}
}

const scheduleService = new ScheduleService();

module.exports = scheduleService;