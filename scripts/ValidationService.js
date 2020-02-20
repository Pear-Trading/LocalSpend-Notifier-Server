const config = require('../config');
const apiService = require('./ApiService');
const errorService = require('./ErrorService');

const { ErrorWithClientMessage } = errorService;

class ValidationService {
	async validateRegistration(user) {
		const { accountType, name, email, postcode, password } = user;
		this.validateAccountType(accountType, true);
		this.validateUserName(name);
		this.validateEmailAddress(email);
		await this.validatePostcode(postcode);
		this.validatePassword(password);

		return true;
	}

	validateAccountType(value, publicOnly = false) {
		this.checkValueIsString(value, 'Account type');
		const selectedType = config.users.accountTypes.find(type => type.id === value);
		if (!selectedType) {
			throw new ErrorWithClientMessage({
				tech: `Account type '${value}' is invalid`,
				client: 'Account type is invalid'
			});
		} else if (publicOnly && !selectedType.public) {
			throw new ErrorWithClientMessage({
				tech: `Account type '${value}' is not public`,
				client: 'Account type is not public. Nice try'
			});
		}
		return true;
	}

	validateUserName(value) {
		this.checkValueIsString(value, 'Name');
		const { maxLength } = config.users.name;
		if (value.length > maxLength) {
			throw new ErrorWithClientMessage({
				tech: `Name must be a maximum of ${maxLength} characters`,
				sameForClient: true
			});
		}
		return true;
	}

	validateEmailAddress(value) {
		this.checkValueIsString(value, 'Email address');
		const { maxLength } = config.users.email;
		if (value.length > maxLength) {
			throw new ErrorWithClientMessage({
				tech: `Email must be a maximum of ${maxLength} characters`,
				sameForClient: true
			});
		} else if (!this.isValidEmailAddress(value)) {
			throw new ErrorWithClientMessage({
				tech: 'Invalid email address',
				sameForClient: true
			});
		}
		return true;
	}

	isValidEmailAddress(value) {
		return value.match(/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/) != null;
	}

	async validatePostcode(value) {
		this.checkValueIsString(value, 'Postcode');
		const isValid = await this.isValidPostcode(value);
		if (!isValid) {
			throw new ErrorWithClientMessage({
				tech: 'Invalid postcode',
				sameForClient: true
			});
		}
		return true;
	}

	async isValidPostcode(value) {
		const responseData = await apiService.checkPostcodeValidity(value);
		return responseData.result;
	}

	validatePassword(value) {
		this.checkValueIsString(value, 'Password');
		const { minLength, maxLength } = config.users.password;
		if (value.length < minLength || value.length > maxLength) {
			throw new ErrorWithClientMessage({
				tech: `Password must be between ${minLength} and ${maxLength} characters`,
				sameForClient: true
			});
		}
		return true;
	}

	validateUserStatus(value) {
		this.checkValueIsString(value, 'User status');
		const validStatuses = config.users.statuses;
		if (validStatuses.indexOf(value) < 0) {
			throw new ErrorWithClientMessage({
				tech: `User status '${value}' is invalid`,
				client: 'User status is invalid'
			});
		}
		return true;
	}

	validateOffer(offer) {
		const { description, dealValue, validFrom, validUntil, validFromCustomEnabled, numUses } = offer;
		this.validateOfferDescription(description);
		this.validateDealValue(dealValue);
		this.validateOfferValidityDates(validFrom, validUntil, validFromCustomEnabled);
		this.validateOfferNumberOfUses(numUses);
		return true;
	}

	validateOfferDescription(value) {
		this.checkValueIsString(value, 'Description');
		const { maxLength } = config.offers.description;
		if (value.length > maxLength) {
			throw new ErrorWithClientMessage({
				tech: `Description must be a maximum of ${maxLength} characters`,
				sameForClient: true
			});
		}
		return true;
	}

	validateDealValue(value) {
		this.checkValueIsString(value, 'Deal value');
		const { maxLength } = config.offers.dealValue;
		if (value.length > maxLength) {
			throw new ErrorWithClientMessage({
				tech: `Deal value must be a maximum of ${maxLength} characters`,
				sameForClient: true
			});
		}

		const containsPercent = value.includes('%'),
			containsPound = value.includes('£'),
			containsPence = value.match(/p/i) != null,
			diffSymbolCount = containsPercent + containsPound + containsPence;
		
		if (diffSymbolCount === 0) {
			throw new ErrorWithClientMessage({
				tech: 'Deal value must contain \'%\', \'£\' or \'p\'',
				sameForClient: true
			});
		} else if (diffSymbolCount > 1) {
			throw new ErrorWithClientMessage({
				tech: 'Deal value: invalid input',
				sameForClient: true
			});
		} else if (containsPercent) {
			const percentValue = parseInt(value);
			if (!value.match(/^[0-9]{1,3}%$/)
					|| percentValue < 1 || percentValue > 100) {
				throw new ErrorWithClientMessage({
					tech: 'Deal value: invalid percent',
					sameForClient: true
				});
			}
		} else if ((containsPound && !this.isValidPoundsString(value))
				|| (containsPence && !this.isValidPenceString(value))) {
			throw new ErrorWithClientMessage({
				tech: 'Deal value: invalid value',
				sameForClient: true
			});
		}

		return true;
	}

	isValidPoundsString(value) {
		return value.match(/^£[0-9]+(.[0-9]{2})?$/) != null;
	}

	isValidPenceString(value) {
		return value.match(/^[0-9]{1,2}p$/i) != null;
	}

	validateOfferValidityDates(validFrom, validUntil, validFromCustomEnabled) {
		if (validFromCustomEnabled) {
			this.checkValueIsString(validFrom, '\'Valid from\' value');
		}
		this.checkValueIsString(validUntil, '\'Valid until\' value');

		const validFromTimestamp = (new Date(validFrom)).getTime(),
			validUntilTimestamp = (new Date(validUntil)).getTime(),
			currentTimestamp = Date.now();

		if (validFromCustomEnabled && validFromTimestamp <= currentTimestamp) {
			throw new ErrorWithClientMessage({
				tech: '\'Valid from\' date must be at a point in the future',
				sameForClient: true
			});
		}

		if (validUntilTimestamp <= currentTimestamp) {
			throw new ErrorWithClientMessage({
				tech: '\'Valid until\' date must be at a point in the future',
				sameForClient: true
			});
		} else if (validFromCustomEnabled && validUntilTimestamp <= validFromTimestamp) {
			throw new ErrorWithClientMessage({
				tech: '\'Valid until\' date must occur after \'Valid from\' date',
				sameForClient: true
			});
		}

		return true;
	}

	validateOfferNumberOfUses(value) {
		this.checkValueIsNumber(value, 'Number of uses');
		if (value < 0) {
			throw new ErrorWithClientMessage({
				tech: 'Number of uses must not be negative',
				sameForClient: true
			});
		}
		return true;
	}

	validateTransactionValue(value) {
		this.checkValueIsString(value, 'Transaction value');

		const containsPound = value.includes('£'),
			containsPence = value.match(/p/i) != null,
			diffSymbolCount = containsPound + containsPence;
		
		if (diffSymbolCount === 0) {
			throw new ErrorWithClientMessage({
				tech: 'Must contain \'£\' or \'p\'',
				sameForClient: true
			});
		} else if (diffSymbolCount > 1) {
			throw new ErrorWithClientMessage({
				tech: 'Invalid input',
				sameForClient: true
			});
		} else if ((containsPound && !this.isValidPoundsString(value))
				|| (containsPence && !this.isValidPenceString(value))) {
			throw new ErrorWithClientMessage({
				tech: 'Invalid value',
				sameForClient: true
			});
		}

		return true;
	}

	checkValueIsString(value, name) {
		if (typeof value !== 'string') {
			throw new ErrorWithClientMessage({
				tech: `${name} must be a string`,
				sameForClient: true
			});
		}
		return true;
	}

	checkValueIsNumber(value, name) {
		if (typeof value !== 'number') {
			throw new ErrorWithClientMessage({
				tech: `${name} must be a number`,
				sameForClient: true
			});
		}
		return true;
	}
}

const validationService = new ValidationService();

module.exports = validationService;