module.exports = getExports();

function formatDateForDisplay(date) {
	const ten = i => {
		return (i < 10 ? '0' : '') + i;
	};
	const YYYY = date.getFullYear(),
		MM = ten(date.getMonth() + 1),
		DD = ten(date.getDate()),
		HH = ten(date.getHours()),
		II = ten(date.getMinutes());

	return `${DD}/${MM}/${YYYY} ${HH}:${II}`;
}

function alterDateToMidnight(date, nextDay = false) {
	const dateMillis = date.setHours(0);
	date = new Date(dateMillis);
	if (nextDay) {
		date.setDate(date.getDate() + 1);
	}
	return date;
}

function moveDateForwardsBy(date, timeUnit, numTimeUnits) {
	switch (timeUnit) {
		case 'hour':
			const timestamp = date.setHours(date.getHours() + numTimeUnits);
			return new Date(timestamp);

		case 'day':
			date.setDate(date.getDate() + numTimeUnits);
			return date;

		case 'week':
			date.setDate(date.getDate() + numTimeUnits * 7);
			return date;

		case 'month':
			date.setMonth(date.getMonth() + numTimeUnits);
			return date;

		case 'year':
			date.setFullYear(date.getFullYear() + numTimeUnits);
			return date;

		default:
			return date;
	}
}

// move date back to date represented by limitingTimestamp if necessary
function limitDateToTimestamp(date, limitingTimestamp) {
	let timestamp = date.getTime();
	timestamp = Math.min(timestamp, limitingTimestamp);
	return new Date(timestamp);
}

function getDayMonthString(date) {
	return `${date.getDate()}/${date.getMonth() + 1}`;
}

function getDayMonthYearString(date) {
	const yearStr = date.getFullYear().toString().slice(2, 4);
	return `${date.getDate()}/${date.getMonth() + 1}/${yearStr}`;
}

function getHoursMinutesString(date) {
	const ten = i => {
		return (i < 10 ? '0' : '') + i;
	};
	return `${ten(date.getHours())}:${ten(date.getMinutes())}`;
}

function getExports() {
	return {
		formatDateForDisplay,
		alterDateToMidnight,
		moveDateForwardsBy,
		limitDateToTimestamp,
		getDayMonthString,
		getDayMonthYearString,
		getHoursMinutesString
	};
}