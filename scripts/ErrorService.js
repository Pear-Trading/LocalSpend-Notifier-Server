const config = require('../config');

// error message with both a technical component and a client-facing component
class ErrorWithClientMessage extends Error {
	constructor(options) {
		super(options.tech);

		const { tech, client, sameForClient } = options,
			technicalMessage = tech;
		let clientMessageItem;
		if (sameForClient) {
			clientMessageItem = { primary: technicalMessage };
		} else if (typeof client === 'object') {
			clientMessageItem = {
				primary: client.pri,
				secondary: client.sec
			};
		} else if (typeof client === 'string') {
			clientMessageItem = { primary: client };
		}

		this.technicalMessage = technicalMessage;
		if (clientMessageItem != null) {
			this.clientMessageItem = clientMessageItem;
		}
	}
}

function handleError(response, error, errorId) {
	console.error(error);
	if (response) {
		response.json(constructResponseDataWithError(errorId, error));
	}
}

function constructResponseDataWithError(errorId, error) {
	const { message, technicalMessage, clientMessageItem } = error;
	let responseDataError = {
		id: errorId
	};

	if (config.environment === 'test') {
		responseDataError.technicalMessage = technicalMessage || message;
		console.log('technicalMessage', responseDataError.technicalMessage);
	}

	if (error instanceof ErrorWithClientMessage && clientMessageItem != null) {
		responseDataError.clientMessageItem = clientMessageItem;
	} else {
		responseDataError.clientMessageItem = {
			primary: 'Sorry, a technical error occurred'
		};
	}

	return {
		success: false,
		errorItem: responseDataError
	};
}

module.exports = {
	ErrorWithClientMessage,
	handleError
};