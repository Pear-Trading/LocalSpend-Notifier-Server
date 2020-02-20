const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const uuid = require('uuid/v4');
const knex = require('knex');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const KnexSessionStore = require('connect-session-knex')(session);

const config = require('./config');
const privateDetails = require('./privateDetails');

const AdvancedChart = require('./modules/AdvancedChart');
const Dates = require('./modules/Dates');
const General = require('./modules/General');
const Notifications = require('./modules/Notifications');
const Offers = require('./modules/Offers');
const PasswordReset = require('./modules/PasswordReset');
const Transactions = require('./modules/Transactions');
const Users = require('./modules/Users');

const errorService = require('./scripts/ErrorService');
const scheduleService = require('./scripts/ScheduleService');
const validationService = require('./scripts/ValidationService');

const { objKeysToCamelCase } = General;
const { ErrorWithClientMessage, handleError } = errorService;

passport.use(new LocalStrategy(
	{ usernameField: 'email' },
	async (email, password, done) => {
		try {
			const user = await Users.findUserWithLoginDetails({ email, password });
			if (!user) {
				return done(null, false, { message: 'Invalid login credentials' });
			} else if (user.status === 'pending') {
				return done(null, false, { message: 'Account is currently awaiting approval' });
			} else if (user.status === 'deactivated') {
				return done(null, false, { message: 'Account has been deactivated' });
			}
			done(null, user);
		} catch (error) {
			done(error);
		}
	}
));

passport.serializeUser((user, done) => {
	done(null, user.userId);
});

passport.deserializeUser(async (id, done) => {
	try {
		const user = await Users.findUserWithId(id);
		if (!user) {
			return done(null, false, {
				id: 'deserialise-user-id-not-found',
				message: `Unable to find user with ID ${id}`
			});
		}
		return done(null, user);
	} catch (error) {
		done(error, false);
	}
});

const app = express();

const db = knex({
	client: 'pg',
	connection: {
		host: 'localhost',
		user: 'postgres',
		password: privateDetails.database.password,
		database: config.database.name
	}
});

app.use(cors({
	credentials: true,
	origin: (origin, callback) => {
		if (config.acceptedOrigins.indexOf(origin) >= 0) {
			callback(null, true);
		} else {
			callback(Error('Disallowed by CORS'));
		}
	}
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '100MB' }));
app.use(session({
	genid: req => {
		return uuid();
	},
	store: new KnexSessionStore({
		knex: db
	}),
	secret: privateDetails.session.secret,
	resave: true,
	saveUninitialized: false,
	cookie: {
		httpOnly: false,
		maxAge: 1000 * 60 * 60 * 24,
		path: '/',
		secure: false
	}
}));
app.use(passport.initialize());
app.use(passport.session());

(function init() {
	initModules();
	scheduleService.setOfferActivationFunctions(Offers.activateOffer, Offers.deactivateOffer);
	Offers.restoreOfferSchedule();
})();

function initModules() {
	General.init({ db });
	Notifications.init({ db });
	Offers.init({ db });
	PasswordReset.init({ db });
	Transactions.init({ db });
	Users.init({ db });
}

app.post('/api/signIn', (req, res, next) => {
	try {
		if (req.isAuthenticated()) {
			throw new ErrorWithClientMessage({
				tech: 'User is already authenticated',
				client: 'You are already signed in'
			});
		}
		res.set('Access-Control-Allow-Origin', config.frontendRoot);
		res.set('Access-Control-Allow-Credentials', 'true');
		res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
		res.set('Access-Control-Allow-Headers', 'Content-Type, Set-Cookie, *');
		passport.authenticate('local', (error, user, info) => {
			if (error || !user || info) {
				try {
					const errorMessage = info.message || 'Authentication error';
					throw new ErrorWithClientMessage({
						tech: errorMessage,
						sameForClient: true
					});
				} catch (error) {
					handleError(res, error, 'sign-in-authentication-failure');
				}
				return error ? next(error) : null;
			}
			req.login(user, error => {
				if (error) {
					handleError(res, error, 'sign-in-authentication-failure');
					return next(error);
				}
				res.json({
					success: true,
					user: {
						name: user.userName,
						type: Users.getAccountTypeInfoForClient(user.userType)
					}
				});
			});
		})(req, res, next);
	} catch (error) {
		handleError(res, error, 'unable-to-sign-in');
	}
});

app.get('/api/signInCheck', (req, res) => {
	const { user } = req;
	if (!user) {
		return res.json({
			success: true,
			loggedIn: false
		});
	}
	res.json({
		success: true,
		loggedIn: true,
		user: {
			name: user.userName,
			type: Users.getAccountTypeInfoForClient(user.userType)
		}
	});
});

app.get('/api/signOut', (req, res) => {
	req.logout();
	res.json({ success: true });
});

app.get('/api/publicAccountTypes', (req, res) => {
	res.json({
		success: true,
		accountTypes: config.users.accountTypes.filter(type => type.public)
	});
});

app.post('/api/register', async (req, res) => {
	try {
		const { user } = req.body,
			{ accountType, name, email, postcode, password } = user;
		try {
			await validationService.validateRegistration(user);
		} catch (error) {
			return handleError(res, error, 'registration-value-invalid');
		}
		const modifiedPostcode = General.modifyPostcodeForStorage(postcode);
		await db.transaction(async (trx) => {
			const userId = await Users.addNewUser(trx, {
				accountType,
				name,
				email,
				postcode: modifiedPostcode
			});
			await Users.addNewLogin(trx, userId, password);
		});
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'unable-to-register');
	}
});

app.post('/api/forgotPassword', async (req, res) => {
	let savedInfo = false;
	try {
		const user = await Users.findUserWithEmail(req.body.email);
		if (user) {
			const uniqueId = await PasswordReset.generateUniqueIdForPasswordReset();
			await PasswordReset.savePasswordResetInfo(user, uniqueId);
			savedInfo = true;
			await PasswordReset.sendPasswordResetEmail(user, uniqueId);
		}
		res.json({ success: true });
	} catch (error) {
		const errorId = savedInfo ? 'unable-to-send-password-reset-email' : 'unable-to-process-forgot-password';
		handleError(res, error, errorId);
	}
});

app.post('/api/passwordResetId', async (req, res) => {
	try {
		const validityInfo = await PasswordReset.checkPasswordResetIdValidity(req.body.id),
			{ valid, reason } = validityInfo;
		res.json({
			success: true,
			valid,
			reason
		});
	} catch (error) {
		handleError(res, error, 'unable-to-validate-password-reset-id');
	}
});

app.put('/api/updateForgottenPassword', async (req, res) => {
	try {
		const { resetId, password } = req.body;
		try {
			validationService.validatePassword(password);
		} catch (error) {
			return handleError(res, error, 'forgotten-password-update-value-invalid');
		}
		const resetInfo = await PasswordReset.findPasswordResetInfo(resetId),
			{ userId, expires, used } = resetInfo;
		if (used) {
			throw new ErrorWithClientMessage({
				tech: 'Reset has already been used',
				sameForClient: true
			});
		} else if (expires < Date.now()) {
			throw new ErrorWithClientMessage({
				tech: 'Reset has expired',
				sameForClient: true
			});
		}
		await db.transaction(async (trx) => {
			await Users.updateUserPassword(trx, userId, password);
			await PasswordReset.markPasswordResetIdAsUsed(trx, resetId);
		});
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'unable-to-update-password');
	}
});

app.get('/api/userAccountDetails', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { userId } = req.user,
			user = await Users.findUserWithId(userId);
		if (!user) {
			throw new ErrorWithClientMessage({
				tech: `Could not find user with ID ${userId}`,
				client: 'Sorry, we could not find your account details'
			});
		}
		const { userName, email, postcode } = user;
		res.json({
			success: true,
			accountDetails: {
				name: userName,
				email,
				postcode
			}
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-account-details');
	}
});

app.put('/api/userAccountDetails', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { name, email, postcode, newPassword, currentPassword } = req.body,
			user = await Users.findUserWithLoginDetails({
				email: req.user.email,
				password: currentPassword
			});
		if (!user) {
			throw new ErrorWithClientMessage({
				tech: 'Invalid user credentials',
				client: 'Incorrect email/current password combination'
			});
		}

		const updateName = name && name !== req.user.userName,
			updateEmail = email && email !== req.user.email,
			updatePostcode = postcode && postcode !== req.user.postcode,
			updatePassword = newPassword && newPassword !== currentPassword;

		if (!updateName && !updateEmail && !updatePostcode && !updatePassword) {
			throw new ErrorWithClientMessage({
				tech: 'Nothing to update!',
				sameForClient: true
			});
		}

		try {
			if (updateName) validationService.validateUserName(name);
			if (updateEmail) validationService.validateEmailAddress(email);
			if (updatePostcode) await validationService.validatePostcode(postcode);
			if (updatePassword) validationService.validatePassword(newPassword);
		} catch (error) {
			return handleError(res, error, 'account-update-value-invalid');
		}

		await Users.updateUserAccountDetails(user, {
			name: updateName ? name : undefined,
			email: updateEmail ? email : undefined,
			postcode: updatePostcode ? postcode : undefined,
			password: updatePassword ? newPassword : undefined
		});
		res.json({
			success: true,
			name
		});
	} catch (error) {
		handleError(res, error, 'unable-to-update-user-account-details');
	}
});

app.post('/api/subscriptionCheck', async (req, res) => {
	const error = checkForRequestError(req, {
		idPrefix: 'check-subscription',
		customChecks: [
			{
				accessor: req => req.body.subscription,
				idSuffix: 'no-subscription',
				messageSuffix: 'a subscription'
			}, {
				accessor: req => req.body.subscription.endpoint,
				idSuffix: 'no-subscription-endpoint',
				messageSuffix: 'a subscription endpoint'
			}
		]
	});
	if (error != null) {
		return res.status(400).json({
			success: false,
			error
		});
	}

	try {
		checkUserIsAuthenticated(req);
		const { endpoint } = req.body.subscription,
			subscription = await Notifications.findSubscriptionWithEndpoint(endpoint);
		if (!subscription) {
			return res.json({
				success: true,
				subscribed: false
			});
		}
		const subscribed = subscription.userId === req.user.userId;
		res.json({
			success: true,
			subscribed: subscribed
		});
	} catch (error) {
		handleError(res, error, 'check-subscription-find-info');
	}
});

app.post('/api/manageSubscription', async (req, res) => {
	const error = checkForRequestError(req, {
		idPrefix: 'manage-subscription',
		customChecks: [
			{
				accessor: req => req.body.subscription,
				idSuffix: 'no-subscription',
				messageSuffix: 'a subscription'
			}, {
				accessor: req => req.body.subscription.endpoint,
				idSuffix: 'no-subscription-endpoint',
				messageSuffix: 'a subscription endpoint'
			}
		]
	});
	if (error != null) {
		return res.status(400).json({
			success: false,
			error
		});
	}

	try {
		checkUserIsAuthenticated(req);
	} catch (error) {
		handleError(res, error, 'manage-subscription-not-authenticated');
	}
	const { userId } = req.user,
		{ subscription, unsubscribe } = req.body;
	if (!unsubscribe) {
		try {
			const subscriptionId = await Notifications.saveSubscription(userId, subscription);
			res.json({ success: true });
		} catch (error) {
			handleError(res, error, 'unable-to-save-subscription');
		}
	} else {
		try {
			await Notifications.removeSubscription(userId, subscription);
			res.json({ success: true });
		} catch (error) {
			handleError(res, error, 'unable-to-remove-subscription');
		}
	}
});

app.post('/api/postOffer', async (req, res) => {
	console.log(
		'Post offer route, authenticated: ', req.isAuthenticated(),
		'- passport: ', req.session.passport,
		'- user: ', req.user
	);

	let currentSection, trx;

	try {
		checkUserIsAuthenticated(req);
		const { offer } = req.body,
			{ userId } = req.user;
		try {
			validationService.validateOffer(offer);
		} catch (error) {
			return handleError(res, error, 'post-offer-value-invalid');
		}
		currentSection = 'saving';
		trx = await db.transaction();
		const offerId = await Offers.saveOffer(trx, userId, offer),
			offerInstances = await Offers.createOfferInstances(offer, userId, offerId);
		await Offers.saveOfferInstances(trx, offerInstances);
		await trx.commit();
		currentSection = 'scheduling';
		scheduleService.scheduleNewOffer(offer, offerId);
		await Offers.saveScheduleForOffer(offer, offerId);
		currentSection = 'notifying';
		await Offers.sendOfferNotifications(offerInstances);
		res.json({ success: true });
	} catch (error) {
		if (!currentSection === 'saving') await trx.rollback();
		let errorId;
		switch (currentSection) {
			case 'saving':
				errorId = 'unable-to-save-offer';
				break;
			case 'scheduling':
				errorId = 'unable-to-schedule-offer';
				break;
			case 'notifying':
				errorId = 'unable-to-send-offer-notifications';
				break;
			default:
				errorId = 'post-offer-unknown-error';
				break;
		}
		handleError(res, error, errorId);
	}
});

app.post('/api/serveOffer', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { offerInstanceIdForCustomer } = req.body,
			offerInstance = await Offers.findOfferInstanceForCustomer(offerInstanceIdForCustomer);
		if (offerInstance == null) {
			throw new ErrorWithClientMessage({
				tech: 'Offer instance for customer not found',
				client: {
					pri: 'Sorry, we could not find an offer instance for the given ID',
					sec: 'This ID is displayed in the page URL'
				}
			});
		} else if (offerInstance.customerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer instance customer ID do not match',
				client: {
					pri: 'Sorry, this offer instance is not valid for the account you are currently signed in to',
					sec: 'You can sign in to another account in the top-right corner'
				}
			});
		}
		const { offerId, uniqueIdForSeller, activated, remainingUses } = offerInstance,
			offer = await Offers.findOfferWithId(offerId);
		Offers.checkOfferIsValidAndActive(offer);
		const { sellerId, usesPerCustomer } = offer;
		if (usesPerCustomer > 0 && remainingUses <= 0) {
			throw new ErrorWithClientMessage({
				tech: 'Out of offer instance uses',
				client: 'Sorry, you have run out of uses for this offer'
			});
		}
		const seller = await Users.findUserWithId(sellerId);
		if (seller == null) {
			throw new ErrorWithClientMessage({
				tech: `Seller with ID ${sellerId} not found`,
				client: 'Sorry, we could not find information on the seller for this offer'
			});
		}
		const responseData = {
			success: true,
			sellerName: seller.userName,
			offer: Offers.formatOfferForClient(offer),
			activated
		};
		if (activated) {
			responseData.codeUrl = Offers.buildServeOfferQrCodeUrl(uniqueIdForSeller);
		}
		res.json(responseData);
	} catch (error) {
		handleError(res, error, 'unable-to-serve-offer');
	}
});

app.post('/api/customerActivateOffer', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { offerInstanceIdForCustomer } = req.body,
			offerInstance = await Offers.findOfferInstanceForCustomer(offerInstanceIdForCustomer);
		if (offerInstance == null) {
			throw new ErrorWithClientMessage({
				tech: 'Offer instance for customer not found',
				client: 'An error occurred activating this offer'
			});
		} else if (offerInstance.customerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer instance customer ID do not match',
				client: {
					pri: 'You are not signed in to the correct account for this offer instance',
					sec: 'Please change user in the top-right menu'
				}
			});
		} else if (offerInstance.activated) {
			throw new ErrorWithClientMessage({
				tech: 'Offer instance has already been activated',
				client: {
					pri: 'This offer instance has already been paid for',
					sec: 'Please refresh the page'
				}
			});
		}
		const { offerId, uniqueIdForSeller } = offerInstance,
			offer = await Offers.findOfferWithId(offerId);
		Offers.checkOfferIsValidAndActive(offer);
		await Offers.customerActivateOffer(offer, offerInstance);
		res.json({
			success: true,
			codeUrl: Offers.buildServeOfferQrCodeUrl(uniqueIdForSeller)
		});
	} catch (error) {
		handleError(res, error, 'unable-to-activate-offer-for-customer');
	}
});

app.post('/api/redeemOffer', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { offerInstanceIdForSeller } = req.body,
			offerInstance = await Offers.findOfferInstanceForSeller(offerInstanceIdForSeller);
		if (offerInstance == null) {
			throw new ErrorWithClientMessage({
				tech: 'Offer instance for seller not found',
				client: {
					pri: 'Sorry, we could not find an offer instance for the given ID',
					sec: 'This ID is shown in the page URL'
				}
			});
		}
		const { offerId, customerId, remainingUses } = offerInstance,
			offer = await Offers.findOfferWithId(offerId);
		if (offer == null) {
			throw new ErrorWithClientMessage({
				tech: `Offer for ID ${offerId} not found`,
				client: 'Sorry, we could not find information on the requested offer'
			});
		} else if (offer.status === 'pending') {
			throw new ErrorWithClientMessage({
				tech: `Offer with ID ${offerId} is pending activation`,
				client: 'This offer is not active yet'
			});
		} else if (offer.status !== 'active') {
			throw new ErrorWithClientMessage({
				tech: `Offer with ID ${offerId} is inactive`,
				client: 'This offer is inactive'
			});
		} else if (offer.sellerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer seller ID do not match',
				client: {
					pri: 'Sorry, you cannot complete the transaction using the account you are currently signed in to',
					sec: 'You can sign in to another account in the top-right corner'
				}
			});
		} else if (offer.usesPerCustomer > 0 && remainingUses <= 0) {
			throw new ErrorWithClientMessage({
				tech: 'Out of offer instance uses',
				client: 'The customer has run out of uses for this offer'
			});
		}
		const customer = await Users.findUserWithId(customerId);
		if (customer == null) {
			throw new ErrorWithClientMessage({
				tech: `Customer with ID ${customerId} not found`,
				client: 'Sorry, we could not find information on the customer for this offer instance'
			});
		}
		res.json({
			success: true,
			sellerName: req.user.userName,
			offer: Offers.formatOfferForClient(offer),
			customerName: customer.userName
		});
	} catch (error) {
		handleError(res, error, 'unable-to-redeem-offer');
	}
});

app.post('/api/completeTransaction', async(req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { offerInstanceIdForSeller, transactionValue } = req.body;
		try {
			validationService.validateTransactionValue(transactionValue);
		} catch (error) {
			return handleError(res, error, 'complete-transaction-value-invalid');
		}
		const offerInstance = await Offers.findOfferInstanceForSeller(offerInstanceIdForSeller);
		if (offerInstance == null) {
			throw new ErrorWithClientMessage({
				tech: 'Offer instance for seller\'s ID not found',
				client: 'This offer instance is not valid'
			});
		}
		const { offerId } = offerInstance,
			offer = await Offers.findOfferWithId(offerId);
		if (offer == null) {
			throw new ErrorWithClientMessage({
				tech: `Offer for ID ${offerId} not found`,
				client: 'Offer not found'
			});
		} else if (offer.sellerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer seller ID do not match',
				client: 'Seller does not match current user'
			});
		}
		const { customerId, instanceId } = offerInstance,
			transactionId = await Transactions.processTransaction(
				offer.sellerId, customerId, offerId, instanceId, transactionValue, new Date()
			);
		if (transactionId == null) {
			throw new ErrorWithClientMessage({
				tech: 'Failed to add transaction info to database',
				client: 'A database error occurred'
			});
		}
		res.json({
			success: true,
			transactionId
		});
	} catch (error) {
		handleError(res, error, 'unable-to-complete-transaction');
	}
});

app.get('/api/profile/summary', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const userSummary = await Users.createUserSummary(req.user.userId);
		res.json({
			success: true,
			summary: userSummary
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-user-summary');
	}
});

app.get('/api/profile/activeOffers', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const offers = await Offers.findActiveOffersFromUser(req.user.userId);
		res.json({
			success: true,
			offers: offers.map(offer => {
				const { offerId, description, dealValue, status, starts, expires } = offer;
				return {
					id: offerId,
					description,
					dealValue,
					status,
					starts: Dates.formatDateForDisplay(starts),
					expires: Dates.formatDateForDisplay(expires)
				};
			})
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-user-offers');
	}
});

app.get('/api/profile/recentTransactions', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { userId } = req.user,
			transactions = await Transactions.findRecentTransactionsInvolvingUser(userId);
		for (let transaction of transactions) {
			const { transactionId, sellerId, customerId, offerId, pointsAwarded } = transaction,
				[ seller, customer, offer ] = await Promise.all([
					Users.findUserWithId(sellerId),
					Users.findUserWithId(customerId),
					offerId != null ? Offers.findOfferWithId(offerId) : null
				]);
			transaction.transactionId = transactionId;
			transaction.pointsAwarded = pointsAwarded;
			transaction.sellerName = seller.userName;
			transaction.customerName = customer.userName;
			transaction.offerDescription = offer ? offer.description : null;
			transaction.monetaryValue = Transactions.determineMonetaryValue(transaction.transactionValue);
		}
		res.json({
			success: true,
			transactions: transactions.map(transaction => {
				const {
					transactionId,
					sellerName,
					customerName,
					offerDescription,
					monetaryValue,
					pointsAwarded,
					timestamp } = transaction;
				return {
					id: transactionId,
					sellerName,
					customerName,
					offerDescription,
					transactionValue: monetaryValue,
					pointsAwarded,
					dateTime: Dates.formatDateForDisplay(timestamp)
				};
			})
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-user-transactions');
	}
});

app.post('/api/profile/advancedChart', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		const { formValues } = req.body;
		AdvancedChart.convertAdvChartFormDatesToDateObjects(formValues);
		const overallTimePeriod = AdvancedChart.calcAdvChartOverallTimePeriod(formValues),
			timePeriods = AdvancedChart.determineAdvChartTimePeriods(formValues, overallTimePeriod),
			transactions = await Transactions.getTransactionsInvolvingUserBetweenDates(
				req.user.userId, overallTimePeriod.startDate, overallTimePeriod.endDate
			),
			chartData = AdvancedChart.createAdvChartData(formValues, transactions, timePeriods);
		res.json({
			success: true,
			chartData
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-adv-chart-data');
	}
});

app.put('/api/updateOffer', async (req, res) => {
	const error = checkForRequestError(req, {
		idPrefix: 'update-offer',
		customChecks: [
			{
				accessor: req => req.body.offer,
				idSuffix: 'no-offer',
				messageSuffix: 'an offer'
			}
		]
	});
	if (error != null) {
		return res.status(400).json({
			success: false,
			error
		});
	}

	try {
		checkUserIsAuthenticated(req);
		const offerId = req.body.offer.id,
			offer = await Offers.findOfferWithId(offerId);
		if (offer == null) {
			throw new ErrorWithClientMessage({
				tech: `Offer with ID ${offerId} not found`,
				client: 'Offer not found'
			});
		} else if (offer.sellerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer seller ID do not match',
				client: 'User ID does not match offer\'s seller ID'
			});
		}
		const success = await Offers.updateOfferDescription(offerId, req.body.offer.description);
		if (!success) {
			throw new ErrorWithClientMessage({
				tech: 'Unable to update offer description',
				sameForClient: true
			});
		}
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'unable-to-update-offer');
	}
});

app.put('/api/deactivateOffer', async (req, res) => {
	const error = checkForRequestError(req, {
		idPrefix: 'deactivate-offer',
		customChecks: [
			{
				accessor: req => req.body.offerId,
				idSuffix: 'no-offer-id',
				messageSuffix: 'an offer ID'
			}
		]
	});
	if (error != null) {
		return res.status(400).json({
			success: false,
			error
		});
	}

	try {
		checkUserIsAuthenticated(req);
		const { offerId } = req.body,
			offer = await Offers.findOfferWithId(offerId);
		if (offer == null) {
			throw new ErrorWithClientMessage({
				tech: `Offer with ID ${offerId} not found`,
				client: 'Offer not found'
			});
		} else if (offer.sellerId !== req.user.userId) {
			throw new ErrorWithClientMessage({
				tech: 'User ID and offer seller ID do not match',
				client: 'User ID does not match offer\'s seller ID'
			});
		}
		await scheduleService.deactivateOffer(offerId);
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'unable-to-deactivate-offer');
	}
});

app.get('/api/admin/usersAwaitingApproval', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'admin');
		const users = await Users.getUsersAwaitingApproval();
		res.json({
			success: true,
			users: users.map(user => {
				const { userId, userName, email, userType } = user;
				return {
					id: userId,
					name: userName,
					email,
					type: userType
				};
			})
		});
	} catch (error) {
		handleError(res, error, 'admin-unable-to-get-users-awaiting-approval');
	}
});

app.get('/api/admin/allUsers', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'admin');
		const users = await Users.getAllUsers();
		res.json({
			success: true,
			users: users.map(user => {
				const { userId, userName, email, userType, status } = user;
				return {
					id: userId,
					name: userName,
					email,
					type: userType,
					status
				};
			})
		});
	} catch (error) {
		handleError(res, error, 'admin-unable-to-get-all-users');
	}
});

app.put('/api/admin/approveUser', async (req, res) => {
	let userApproved = false;
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'admin');
		const userId = req.body.id;
		await Users.approveUser(userId);
		userApproved = true;
		const user = await Users.findUserWithId(userId);
		await Users.sendApprovalEmail(user);
		res.json({ success: true });
	} catch (error) {
		const errorId = userApproved ? 'admin-unable-to-send-approval-email' : 'admin-unable-to-approve-user';
		handleError(res, error, errorId);
	}
});

app.put('/api/admin/updateUser', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'admin');
		const { userId, status } = req.body;
		validationService.validateUserStatus(status);
		await Users.updateUserStatus(userId, status);
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'admin-unable-to-update-user');
	}
});

app.get('/api/admin/getAdminData', async (req, res) => {
	try {
		// checkUserHasPriveleges(req.user, 'admin');
		const userRows = await db('users').select('*'),
			offerRows = await db('offers')
				.innerJoin('users', 'offers.seller_id', 'users.user_id')
				.orderBy('offer_id'),
			userPointsDataRows = await db('points_awarded')
				.innerJoin('users', 'points_awarded.user_id', 'users.user_id')
				.orderBy('total_points', 'desc');

		const [ users, offers, userPointsData ] = [
			objKeysToCamelCase(userRows),
			objKeysToCamelCase(offerRows),
			objKeysToCamelCase(userPointsDataRows)
		];

		res.json({
			success: true,
			data: {
				users: users.map(user => ({
					name: user.userName,
					email: user.email
				})),
				offers: offers.map(offer => ({
					id: offer.offerId,
					sellerName: offer.userName,
					description: offer.description
				})),
				userPointsData: userPointsData.map(dataEntry => ({
					user: {
						id: dataEntry.userId,
						name: dataEntry.userName
					},
					points: dataEntry.totalPoints
				}))
			}
		});
	} catch (error) {
		handleError(res, error, 'unable-to-retrieve-admin-data');
	}
});

app.post('/api/admin/getPointsBetweenDates', async (req, res) => {
	const error = checkForRequestError(req, {
		idPrefix: 'get-points-between-dates',
		customChecks: [
			{
				accessor: req => req.body.startDate,
				idSuffix: 'no-start-date',
				messageSuffix: 'a start date'
			}, {
				accessor: req => req.body.endDate,
				idSuffix: 'no-end-date',
				messageSuffix: 'an end date'
			}
		]
	});
	if (error != null) {
		return res.status(400).json({
			success: false,
			error
		});
	}

	try {
		// checkUserHasPriveleges(req.user, 'admin');
		const startDate = Dates.alterDateToMidnight(new Date(req.body.startDate)),
			endDate = Dates.alterDateToMidnight(new Date(req.body.endDate), true),
			transactions = await Transactions.getAllTransactionsBetweenDatesCustomerJoin(startDate, endDate);
		let userData = [];
		for (let transaction of transactions) {
			const existingUserDataEntry = userData.find(dataEntry => (
				dataEntry.userId === transaction.userId
			));
			if (existingUserDataEntry != null) {
				existingUserDataEntry.points += transaction.pointsAwarded;
			} else {
				const { userId, userName, pointsAwarded } = transaction;
				userData.push({
					userId,
					userName,
					points: pointsAwarded
				});
			}
		}
		for (let userDataEntry of userData) {
			delete userDataEntry.userId;
		}
		userData.sort((a, b) => b.points - a.points);
		res.json({
			success: true,
			data: userData
		});
	} catch (error) {
		handleError(res, error, 'unable-to-get-points-between-dates');
	}
});

app.post('/api/dev/newUser', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'dev');
		const { name, type } = req.body.formValues;
		validationService.validateAccountType(type);
		const userId = await Users.addNewTestUser(name, type);
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'dev-unable-to-add-new-user');
	}
});

app.post('/api/dev/newLogin', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'dev');
		const { userId, password } = req.body.formValues;
		await db.transaction(async (trx) => {
			await Users.addNewLogin(trx, userId, password);
		});
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'dev-unable-to-add-new-login');
	}
});

app.post('/api/dev/newTransactions', async (req, res) => {
	try {
		checkUserIsAuthenticated(req);
		Users.checkUserHasPriveleges(req.user, 'dev');
		const { transactions } = req.body;
		for (let transaction of transactions) {
			const { sellerId, customerId, value, date } = transaction;
			await Transactions.processTransaction(sellerId, customerId, null, null, value, date);
		}
		/*await Promise.all(transactions.map(transaction => {
			const { sellerId, customerId, value, date } = transaction;
			return processTransaction(sellerId, customerId, null, value, date);
		}));*/
		res.json({ success: true });
	} catch (error) {
		handleError(res, error, 'dev-unable-to-add-new-transactions-dev');
	}
});

function checkForRequestError(req, settings) {
	if (!req.body) {
		return {
			id: `${settings.idPrefix}-no-body`,
			message: 'Request did not supply a body'
		};
	}

	for (let check of settings.customChecks) {
		if (!check.accessor(req)) {
			return {
				id: `${settings.idPrefix}-${check.idSuffix}`,
				message: `Request did not supply ${check.messageSuffix}`
			};
		}
	}

	return null;
}

function checkUserIsAuthenticated(request, includeSecondaryErrorMessage = true) {
	if (!request.isAuthenticated()) {
		let clientMessageItem = { pri: 'You are not signed in' };
		if (includeSecondaryErrorMessage) {
			clientMessageItem.sec = 'Please refresh the page';
		}
		throw new ErrorWithClientMessage({
			tech: 'User is not authenticated',
			client: clientMessageItem
		});
	}
	return true;
}

app.listen(4000);