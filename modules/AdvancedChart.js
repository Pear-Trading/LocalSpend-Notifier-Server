module.exports = getExports();

const Dates = require('./Dates');
const Transactions = require('./Transactions');

function calcAdvChartOverallTimePeriod(formValues) {
	const {
		timeUnit,
		timePeriodMode,
		forTimeUnit,
		forNumTimeUnits,
		forStartDateTime,
		forStartDate,
		betweenStartDateTime,
		betweenStartDate,
		betweenEndDateTime,
		betweenEndDate
	} = formValues;

	let timePeriodStartDate, timePeriodEndDate;

	if (timePeriodMode === 'for') {
		if (timeUnit === 'hour') {
			timePeriodStartDate = forStartDateTime;
		} else {
			timePeriodStartDate = Dates.alterDateToMidnight(forStartDate);
		}
		timePeriodEndDate = determineAdvChartEndDate(timePeriodStartDate, forTimeUnit, forNumTimeUnits);
	} else if (timePeriodMode === 'between') {
		if (timeUnit === 'hour') {
			timePeriodStartDate = betweenStartDateTime;
			timePeriodEndDate = betweenEndDateTime;
		} else {
			timePeriodStartDate = Dates.alterDateToMidnight(betweenStartDate);
			timePeriodEndDate = Dates.alterDateToMidnight(betweenEndDate, true);
		}
	}

	console.log('calcAdvChartTimePeriod', timePeriodStartDate.toString(), timePeriodEndDate.toString());
	return {
		startDate: timePeriodStartDate,
		endDate: timePeriodEndDate
	};
}

function convertAdvChartFormDatesToDateObjects(formValues) {
	const dateKeys = [
		'forStartDate',
		'forStartDateTime',
		'betweenStartDate',
		'betweenStartDateTime',
		'betweenEndDate',
		'betweenEndDateTime'
	];

	function convertDateToDateObject(date) {
		return new Date(date);
	}

	for (let key of dateKeys) {
		formValues[key] = convertDateToDateObject(formValues[key]);
	}
}

function determineAdvChartEndDate(startTimestamp, timeUnit, numTimeUnits) {
	const startDate = new Date(startTimestamp);
	console.log('dACED', startDate.toString(), timeUnit, numTimeUnits);
	let endDate = new Date(startTimestamp);
	Dates.moveDateForwardsBy(endDate, timeUnit, numTimeUnits);
	console.log('determineAdvChartEndDate start', startDate.toString());
	console.log('determineAdvChartEndDate end', endDate.toString());
	return endDate;
}

function determineAdvChartTimePeriods(formValues, overallTimePeriod) {
	const { timeUnit, timeIntervalChecked, timeInterval } = formValues;
	let timePeriods = [];

	const startTimestamp = overallTimePeriod.startDate.getTime(),
		endTimestamp = overallTimePeriod.endDate.getTime();
	let t = startTimestamp;

	while (t < endTimestamp) {
		const timePeriodStartDate = new Date(t);
		let timePeriodEndDate = new Date(t);

		Dates.moveDateForwardsBy(timePeriodEndDate, timeUnit, 1);
		timePeriodEndDate = Dates.limitDateToTimestamp(timePeriodEndDate, endTimestamp);
		const timePeriodEndTimestamp = timePeriodEndDate.getTime();

		const timePeriodName = generateAdvChartTimePeriodName(
			timeUnit, timePeriodStartDate, timePeriodEndDate, timeIntervalChecked.length ? timeInterval : null
		);

		timePeriods.push({
			start: {
				timestamp: t,
				date: timePeriodStartDate
			},
			end: {
				timestamp: timePeriodEndTimestamp,
				date: timePeriodEndDate
			},
			name: timePeriodName
		});

		if (timeIntervalChecked.length) {
			const nextTimePeriodStartDate = new Date(t);
			Dates.moveDateForwardsBy(nextTimePeriodStartDate, timeInterval, 1);
			t = nextTimePeriodStartDate.getTime();
		} else {
			t = timePeriodEndTimestamp;
		}
	}

	return timePeriods;
}

function generateAdvChartTimePeriodName(timeUnit, startDate, endDate, timeInterval) {
	const { getDayMonthString, getDayMonthYearString, getHoursMinutesString } = Dates;

	// take a millisecond off the end date
	const endTimestamp = endDate.getTime() - 1;
	endDate = new Date(endTimestamp);

	switch (timeUnit) {
		case 'hour':
			let startDateStr, endDateStr;
			if (timeInterval) {
				if (startDate.getDate() === endDate.getDate()) {
					return getDayMonthString(startDate);
				} else {
					startDateStr = getDayMonthString(startDate);
					endDateStr = getDayMonthString(endDate);
				}
			} else {
				startDateStr = `${getHoursMinutesString(startDate)} ${getDayMonthString(startDate)}`;
				endDateStr = `${getHoursMinutesString(endDate)} ${getDayMonthString(endDate)}`;
			}
			return `${startDateStr} - ${endDateStr}`;

		case 'day':
			const dayName = startDate.toLocaleString('en-GB', { weekday: 'short' });
			return `${dayName} ${getDayMonthString(startDate)}`;

		case 'week':
			return `${getDayMonthString(startDate)} - ${getDayMonthString(endDate)}`;

		case 'month':
			if (startDate.getDate() === 1) {
				return startDate.toLocaleString('en-GB', { month: 'long' });
			}
			return `${getDayMonthString(startDate)} - ${getDayMonthString(endDate)}`;

		case 'year':
			if (startDate.getDate() === 1 && startDate.getMonth() === 0) {
				return startDate.getFullYear();
			}
			return `${getDayMonthYearString(startDate)} - ${getDayMonthYearString(endDate)}`;

		default:
			return 'dave';
	}
}

function createAdvChartData(formValues, transactions, timePeriods) {
	const xAxisName = timePeriods.some(period => period.name.includes('/')) ? 'Date' : 'Time';

	const { timeIntervalChecked, timeUnit } = formValues;
	let subtitle;
	if (timeIntervalChecked.length && timeUnit === 'hour') {
		const startTimeStr = getHoursMinutesString(timePeriods[0].start.date),
			endTimeStr = getHoursMinutesString(timePeriods[0].end.date);
		subtitle = `${startTimeStr} - ${endTimeStr}`;
	}

	let transactionData = [],
		chartData = {
			subtitle,
			xAxisName,
			timePeriodData: []
		};

	for (let transaction of transactions) {
		transactionData.push({
			transaction,
			timestamp: transaction.timestamp.getTime()
		});
	}

	for (let period of timePeriods) {
		let curTimePeriodDataEntry = {
			name: period.name,
			numTransactions: 0,
			transactionsValue: {
				raw: 0,
				monetary: ''
			},
			pointsAwarded: 0
		};
		for (let transactionDataEntry of transactionData) {
			const { transaction, timestamp } = transactionDataEntry;
			if (timestamp >= period.start.timestamp && timestamp < period.end.timestamp) {
				curTimePeriodDataEntry.numTransactions++;
				curTimePeriodDataEntry.transactionsValue.raw += transaction.transactionValue;
				curTimePeriodDataEntry.pointsAwarded += transaction.pointsAwarded;
			}
		}
		curTimePeriodDataEntry.transactionsValue.monetary = Transactions.determineMonetaryValue(
			curTimePeriodDataEntry.transactionsValue.raw
		);
		chartData.timePeriodData.push(curTimePeriodDataEntry);
	}

	return chartData;
}

function getExports() {
	return {
		calcAdvChartOverallTimePeriod,
		convertAdvChartFormDatesToDateObjects,
		determineAdvChartTimePeriods,
		createAdvChartData
	};
}