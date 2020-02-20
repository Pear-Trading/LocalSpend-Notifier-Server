module.exports = getExports();

const General = require('./General');
const errorService = require('../scripts/ErrorService');

const { objKeysToCamelCase } = General;
const { ErrorWithClientMessage } = errorService;

let db;

function init(serverVariables) {
	db = serverVariables.db;
}

async function processTransaction(sellerId, customerId, offerId, offerInstanceId, transactionValueStr, date) {
	const transactionValue = determineTransactionValue(transactionValueStr),
		pointsToAward = determinePointsToAward(transactionValue);
	let transactionId;
	try {
		await db.transaction(async (trx) => {
			transactionId = await saveTransaction(
				trx, sellerId, customerId, offerId, transactionValue, pointsToAward, date
			);
			await saveTransactionPoints(trx, customerId, pointsToAward);
			await Offers.saveOfferInstanceUse(trx, offerId, offerInstanceId);
		});
	} catch (error) {
		console.error(error);
		transactionId = null;
	}
	return transactionId;
}

async function saveTransaction(
	dbTransaction, sellerId, customerId, offerId, transactionValue, pointsToAward, date
) {
	const transactionIds = await dbTransaction('transactions')
		.insert({
			seller_id: sellerId,
			customer_id: customerId,
			offer_id: offerId,
			transaction_value: transactionValue,
			points_awarded: pointsToAward,
			timestamp: date
		})
		.returning('transaction_id');

	if (!transactionIds.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add transaction to database transaction',
			client: 'Unable to save transaction to database'
		});
	}

	return transactionIds[0];
}

function determineTransactionValue(valueStr) {
	if (valueStr.includes('p')) {
		return parseInt(valueStr.replace('p', ''));
	} else if (valueStr.includes('£')) {
		valueStr = valueStr.replace('£', '');
		if (valueStr.includes('.')) {
			const [ poundsStr, penceStr ] = valueStr.split('.');
			return parseInt(poundsStr) * 100 + parseInt(penceStr);
		} else {
			return parseInt(valueStr) * 100;
		}
	} else {
		throw new ErrorWithClientMessage({
			tech: 'Could not determine transaction value',
			sameForClient: true
		});
	}
}

function determinePointsToAward(transactionValue) {
	return transactionValue * 10;
}

async function saveTransactionPoints(dbTransaction, customerId, points) {
	const customerEntryExists = await Users.checkUserEntryExists(
		dbTransaction, 'points_awarded', 'user_id', customerId
	);
	if (!customerEntryExists) {
		const newEntries = await dbTransaction('points_awarded')
			.insert({
				user_id: customerId,
				total_points: 0
			})
			.returning('*');
		if (!newEntries.length) {
			throw new ErrorWithClientMessage({
				tech: 'Failed to add points table customer entry to database transaction',
				client: 'Unable to save transaction points entry'
			});
		}
	}
	const newPoints = await dbTransaction('points_awarded')
		.where({ user_id: customerId })
		.increment('total_points', points)
		.returning('total_points');
	if (!newPoints.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add transaction points to database transaction',
			client: 'Unable to save transaction points'
		});
	}
	return newPoints[0];
}

async function getAllTransactionsBetweenDatesCustomerJoin(startDate, endDate) {
	const transactions = await db('transactions')
		.where('timestamp', '>=', startDate)
		.andWhere('timestamp', '<', endDate)
		.innerJoin('users', 'transactions.customer_id', 'users.user_id')
		.orderBy('transaction_id')
		.select('*');
	return transactions.length ? objKeysToCamelCase(transactions) : [];
}

async function getTransactionsInvolvingUserBetweenDates(userId, startDate, endDate) {
	const transactions = await db('transactions')
		.where(function() {
			this.where({ seller_id: userId }).orWhere({ customer_id: userId })
		})
		.andWhere('timestamp', '>=', startDate)
		.andWhere('timestamp', '<', endDate)
		.orderBy('transaction_id')
		.select('*');
	return transactions.length ? objKeysToCamelCase(transactions) : [];
}

function determineMonetaryValue(transactionValue) {
	if (transactionValue < 100) {
		return `${transactionValue}p`;
	}
	const poundValue = Math.floor(transactionValue / 100);
	let penceValue = transactionValue - poundValue * 100;
	if (penceValue) {
		if (penceValue < 10) penceValue = `0${penceValue}`;
		return `£${poundValue}.${penceValue}`;
	}
	return `£${poundValue}`;
}

async function findAllTransactionsInvolvingUser(userId) {
	const transactions = await db('transactions')
		.where({ seller_id: userId })
		.orWhere({ customer_id: userId })
		.orderBy('transaction_id')
		.select('*');
	return transactions.length ? objKeysToCamelCase(transactions) : [];
}

async function findRecentTransactionsInvolvingUser(userId) {
	const currentDate = new Date(),
		date = currentDate.getDate(),
		dateOneWeekAgo = new Date(currentDate.setDate(date - 7));

	const transactions = await db('transactions')
		.where(function() {
			this.where({ seller_id: userId }).orWhere({ customer_id: userId })
		})
		.andWhere('timestamp', '>=', dateOneWeekAgo)
		.orderBy('transaction_id', 'desc')
		.select('*');

	return transactions.length ? objKeysToCamelCase(transactions) : [];
}

function getExports() {
	return {
		init,
		processTransaction,
		saveTransaction,
		determineTransactionValue,
		determinePointsToAward,
		saveTransactionPoints,
		getAllTransactionsBetweenDatesCustomerJoin,
		getTransactionsInvolvingUserBetweenDates,
		determineMonetaryValue,
		findAllTransactionsInvolvingUser,
		findRecentTransactionsInvolvingUser
	};
}