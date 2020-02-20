module.exports = getExports();

const nodemailer = require('nodemailer');

const config = require('../config');
const privateDetails = require('../privateDetails');
const General = require('./General');
const Offers = require('./Offers');
const Transactions = require('./Transactions');
const errorService = require('../scripts/ErrorService');

const { objKeysToCamelCase, hashPassword, comparePasswords } = General;
const { ErrorWithClientMessage } = errorService;

let db;

const mailTransporter = nodemailer.createTransport({
	service: 'gmail',
	auth: {
		user: privateDetails.email.address,
		pass: privateDetails.email.password
	}
});

function init(serverVariables) {
	db = serverVariables.db;
}

async function findUserWithLoginDetails(loginDetails) {
	const users = await db('users')
		.innerJoin('logins', 'users.user_id', 'logins.user_id')
		.where({
			email: loginDetails.email
		});
	if (!users.length) {
		return null;
	}
	const user = users[0];
	return new Promise((resolve, reject) => {
		comparePasswords(loginDetails.password, user.password, (error, result) => {
			if (result) {
				resolve(objKeysToCamelCase(user));
			}
			resolve(null);
		});
	});
}

async function findUserWithName(name) {
	const users = await db('users')
		.where({ user_name: name })
		.select('*');
	return users.length ? objKeysToCamelCase(users[0]) : null;
}

async function findUserWithId(userId) {
	const users = await db('users')
		.where({ user_id: userId })
		.select('*');
	return users.length ? objKeysToCamelCase(users[0]) : null;
}

async function findUserWithEmail(email) {
	const users = await db('users')
		.where({ email })
		.select('*');
	return users.length ? objKeysToCamelCase(users[0]) : null;
}

async function findIdForMatchingUser(searchUser) {
	const user = await findUserWithName(searchUser.name);
	return user ? user.userId : null;
}

async function findTotalPointsForUser(userId) {
	const rows = await db('points_awarded')
		.where({ user_id: userId })
		.select('total_points');
	return rows.length ? rows[0].total_points : null;
}

async function createUserSummary(userId) {
	const [ user, activeOffers, transactions, totalPoints ] = await Promise.all([
		findUserWithId(userId),
		Offers.findActiveOffersFromUser(userId),
		Transactions.findAllTransactionsInvolvingUser(userId),
		findTotalPointsForUser(userId)
	]);
	if (!user) {
		throw new ErrorWithClientMessage({
			tech: `Unable to find user with ID ${userId}`,
			client: 'User not found'
		});
	}
	return {
		name: user.userName,
		email: user.email,
		totalActiveOffers: activeOffers.length,
		totalTransactions: transactions.length,
		totalPoints
	};
}

function checkUserHasPriveleges(user, minPrivelegeLevel) {
	const { userType } = user,
		accountTypeInfo = config.users.accountTypes.find(type => type.id === userType);
	if (!accountTypeInfo) {
		throw new ErrorWithClientMessage({
			tech: `Account type info for ${userType} not found`,
			client: 'Unable to find account type info'
		});
	}

	if (minPrivelegeLevel === 'dev' && !accountTypeInfo.hasDevPriveleges) {
		throw new ErrorWithClientMessage({
			tech: 'Account with dev priveleges required to access this endpoint!',
			sameForClient: true
		});
	} else if (minPrivelegeLevel === 'admin' && !accountTypeInfo.hasAdminPriveleges) {
		throw new ErrorWithClientMessage({
			tech: 'Account with admin priveleges required to access this endpoint!',
			sameForClient: true
		});
	}

	return true;
}

async function getUsersAwaitingApproval() {
	const users = await db('users')
		.where({ status: 'pending' })
		.orderBy('user_id')
		.select('*');
	return objKeysToCamelCase(users);
}

async function getAllUsers() {
	const users = await db('users')
		.orderBy('user_id')
		.select('*');
	return objKeysToCamelCase(users);
}

async function approveUser(userId) {
	await db('users')
		.update({ status: 'active' })
		.where({ user_id: userId });
}

async function updateUserStatus(userId, status) {
	await db('users')
		.update({ status })
		.where({ user_id: userId });
}

async function updateUserAccountDetails(user, newValues) {
	const { name, email, postcode, password } = newValues,
		{ userId } = user;

	await db.transaction(async (trx) => {
		if (name || email || postcode) {
			const users = await trx('users')
				.update({
					user_name: name,
					email,
					postcode
				})
				.where({ user_id: userId })
				.returning('*');
			if (!users.length) {
				throw new ErrorWithClientMessage({
					tech: 'Failed to update users table',
					client: 'Unable to update user info'
				});
			}
		}

		if (password) {
			const passwordUpdated = await updateUserPassword(trx, userId, password);
			if (!passwordUpdated) {
				throw new ErrorWithClientMessage({
					tech: 'Failed to update logins table',
					client: 'Unable to update login info'
				});
			}
		}
	});
}

async function updateUserPassword(dbTransaction, userId, password) {
	return new Promise((resolve, reject) => {
		hashPassword(password, async (error, hash) => {
			if (hash) {
				const logins = await dbTransaction('logins')
					.update({ password: hash })
					.where({ user_id: userId })
					.returning('*');
				if (!logins.length) {
					reject(new ErrorWithClientMessage({
						tech: 'Failed to update password',
						client: 'Sorry, your password was not updated'
					}));
				}
				resolve(true);
			}
			reject(error);
		});
	});
}

async function addNewUser(dbTransaction, user) {
	const { accountType, name, email, postcode } = user;

	const rowsWithMatchingEmail = await dbTransaction('users')
		.where({ email })
		.select('*');
	if (rowsWithMatchingEmail.length > 0) {
		throw new ErrorWithClientMessage({
			tech: 'Email address is already in use',
			sameForClient: true
		});
	}

	const userIds = await dbTransaction('users')
			.insert({
				user_type: accountType,
				user_name: name,
				email,
				postcode,
				status: 'pending'
			})
			.returning('user_id');
	if (!userIds.length) {
		throw new ErrorWithClientMessage({
			tech: 'Failed to add user to database transaction',
			client: 'Unable to save registration to database'
		});
	}
	return userIds[0];
}

async function addNewLogin(dbTransaction, userId, password) {
	return new Promise((resolve, reject) => {
		hashPassword(password, async (error, hash) => {
			if (hash) {
				const rows = await dbTransaction('logins')
					.insert({
						user_id: userId,
						password: hash
					})
					.returning('*');
				if (!rows.length) {
					reject(Error('Failed to add login to database transaction'));
				}
				resolve(true);
			}
			reject(error);
		});
	});
}

async function addNewTestUser(name, accountType) {
	await db.transaction(async (trx) => {
		await addNewUser(trx, {
			name,
			email: 'someone@gmail.com',
			accountType
		});
	});
}

async function sendEmailToUser(user, subject, htmlBody) {
	const address = user.email,
		mailOptions = {
			from: `"${config.email.displayName}" <${privateDetails.email.address}>`,
			to: `"${user.userName}" <${address}>`,
			subject,
			html: htmlBody
		};

	return new Promise((resolve, reject) => {
		mailTransporter.sendMail(mailOptions, (error, info) => {
			if (error) {
				console.error(error);
				reject(Error(`Failed to send email to '${address}'`));
			} else {
				console.log(`Email sent - response: ${info.response}`);
				resolve();
			}
		});
	});
}

async function checkUserEntryExists(dbTransaction, tableName, userIdColumnName, userId) {
	const entries = await dbTransaction(tableName)
		.where(userIdColumnName, userId)
		.select('*');
	console.log('checkUserEntryExists', userId, entries.length);
	return entries.length > 0;

	/*const numTransactionEntries = await dbTransaction(tableName)
		.where(userIdColumnName, userId)
		.returning('*');
	return numTransactionEntries;*/
}

function getAccountTypeInfoForClient(forType) {
	const accountType = config.users.accountTypes.find(type => type.id === forType);
	if (!accountType) return {};
	const { id, hasAdminPriveleges, hasDevPriveleges } = accountType;
	return { id, hasAdminPriveleges, hasDevPriveleges };
}

async function sendApprovalEmail(user) {
	const subject = 'Your ESTA account has been approved!',
		html = (
			'<html>'
				+ '<body style="text-align: center; background-color: #333; color: #fff">'
					+ '<div style="padding-top: 3.5rem">'
						+ '<h2>Congratulations!</h2>'
					+ '</div>'
					+ '<div style="padding-top: 1.35rem; padding-bottom: 3.5rem">'
						+ '<h4>You may now sign in to your account</h4>'
					+ '</div>'
				+ '</body>'
			+ '</html>'
		);

	return sendEmailToUser(user, subject, html);
}

function getExports() {
	return {
		init,
		findUserWithLoginDetails,
		findIdForMatchingUser,
		findUserWithName,
		findUserWithId,
		findTotalPointsForUser,
		createUserSummary,
		checkUserHasPriveleges,
		getUsersAwaitingApproval,
		getAllUsers,
		approveUser,
		updateUserStatus,
		updateUserAccountDetails,
		updateUserPassword,
		addNewUser,
		addNewLogin,
		addNewTestUser,
		findUserWithEmail,
		sendEmailToUser,
		checkUserEntryExists,
		getAccountTypeInfoForClient,
		sendApprovalEmail
	};
}