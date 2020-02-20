module.exports = getExports();

const bcrypt = require('bcrypt');
const camelCase = require('camelcase');
const uuid = require('uuid/v4');

const config = require('../config');

let db;

function init(serverVariables) {
	db = serverVariables.db;
}

function objKeysToCamelCase(input) {
	const inputIsArray = Array.isArray(input);

	let array, obj;
	if (inputIsArray) {
		array = input;
	} else {
		obj = input;
		array = [obj];
	}

	for (let obj of array) {
		for (let key in obj) {
			const keyCamelCase = camelCase(key);
			if (keyCamelCase !== key) {
				obj[keyCamelCase] = obj[key];
				delete obj[key];
			}
		}
	}

	return inputIsArray ? array : obj;
}

// 'la1yz2' -> 'LA1 YZ2'
function modifyPostcodeForStorage(postcode) {
	let newPostcode = postcode.toUpperCase();
	newPostcode = newPostcode.replace(' ', '');
	const insertSpaceIndex = newPostcode.length - 3;
	newPostcode = newPostcode.slice(0, insertSpaceIndex) + ' ' + newPostcode.slice(insertSpaceIndex);
	return newPostcode;
}

function hashPassword(password, callback) {
	bcrypt.hash(password, config.numSaltRounds, (error, hash) => {
		callback(error, hash);
	});
}

function comparePasswords(pass1, pass2, callback) {
	bcrypt.compare(pass1, pass2, (error, result) => {
		callback(error, result);
	});
}

async function generateUniqueIdForTableColumn(tableName, columnName) {
	while (true) {
		const uniqueId = uuid(),
			matchingRows = await db(tableName)
				.where(columnName, uniqueId)
				.select('*');
		if (!matchingRows.length) return uniqueId;
	}
}

function getExports() {
	return {
		init,
		objKeysToCamelCase,
		modifyPostcodeForStorage,
		hashPassword,
		comparePasswords,
		generateUniqueIdForTableColumn
	};
}