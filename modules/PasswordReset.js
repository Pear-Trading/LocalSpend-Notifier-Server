module.exports = getExports();

const config = require('../config');
const General = require('./General');
const Users = require('./Users');
const errorService = require('../scripts/ErrorService');

const { objKeysToCamelCase, generateUniqueIdForTableColumn } = General;
const { ErrorWithClientMessage } = errorService;

let db;

function init(serverVariables) {
	db = serverVariables.db;
}

async function generateUniqueIdForPasswordReset() {
	return generateUniqueIdForTableColumn('password_resets', 'unique_id');
}

async function savePasswordResetInfo(user, uniqueId) {
	const expiryDate = new Date();
	expiryDate.setDate(expiryDate.getDate() + 1);
	const rows = await db('password_resets')
		.insert({
			user_id: user.userId,
			unique_id: uniqueId,
			expires: expiryDate
		})
		.returning('*');
	if (!rows.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add password reset info to database',
			client: 'Sorry, a database error occurred. Please try again'
		});
	}
	return true;
}

async function sendPasswordResetEmail(user, uniqueId) {
	const link = `${config.frontendRoot}/passwordReset/${uniqueId}/`,
		subject = 'Password reset for your ESTA account',
		html = (
			'<html>'
				+ '<body style="text-align: center; background-color: #333; color: #fff">'
					+ '<div style="padding-top: 3.5rem; padding-bottom: 3.5rem">'
						+ `<h4>`
							+ `<a href="${link}" style="text-decoration: none; color: #007bff">`
								+ `Click here`
							+ `</a>`
							+ ` to reset your password`
						+ `</h4>`
					+ '</div>'
				+ '</body>'
			+ '</html>'
		);

	return Users.sendEmailToUser(user, subject, html);
}

async function checkPasswordResetIdValidity(id) {
	const rows = await db('password_resets')
		.where({ unique_id: id })
		.select('*');
	if (rows.length === 0) {
		return {
			valid: false,
			reason: 'Sorry, we could not find an entry for this password reset'
		};
	};
	const row = rows[0];
	if (row.used) {
		return {
			valid: false,
			reason: 'Sorry, this password reset has already been used'
		};
	} else if (row.expires.getTime() < Date.now()) {
		return {
			valid: false,
			reason: 'Sorry, this password reset has expired'
		};
	}
	return {
		valid: true
	};
}

async function findPasswordResetInfo(id) {
	const rows = await db('password_resets')
		.where({ unique_id: id })
		.select('*');
	if (!rows.length) {
		throw new ErrorWithClientMessage({
			tech: 'Could not find entry for password reset ID',
			client: 'Reset is not valid'
		});
	}
	return objKeysToCamelCase(rows[0]);
}

async function markPasswordResetIdAsUsed(dbTransaction, id) {
	const rows = await dbTransaction('password_resets')
		.update({ used: true })
		.where({ unique_id: id })
		.returning('*');
	if (!rows.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to mark password reset ID as used',
			client: 'Sorry, a database error occurred'
		});
	}
	return true;
}

function getExports() {
	return {
		init,
		generateUniqueIdForPasswordReset,
		savePasswordResetInfo,
		sendPasswordResetEmail,
		checkPasswordResetIdValidity,
		findPasswordResetInfo,
		markPasswordResetIdAsUsed
	};
}