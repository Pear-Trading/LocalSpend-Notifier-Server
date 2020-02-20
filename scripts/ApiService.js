const fetch = require('node-fetch');

const errorService = require('./ErrorService');

const { ErrorWithClientMessage } = errorService;

class ApiService {
	constructor() {
		this.fetchMethods = [
			{
				name: 'GET',
				fetchFunction: this.get,
				sendData: false
			}
		];
	}

	async fetchWithoutData(url, method) {
		return fetch(url, {
			method
		});
	}

	async get(url) {
		return this.fetchWithoutData(url, 'GET');
	}

	async sendRequest(url, method, data) {
		const apiFetchMethod = this.determineApiFetchMethod(method);
		let response;
		if (apiFetchMethod.sendData) {
			response = await apiFetchMethod.fetchFunction.call(this, url, data);
		} else {
			response = await apiFetchMethod.fetchFunction.call(this, url);
		}
		const responseData = response ? await response.json() : null;
		this.checkResponseForError(response, responseData);
		return responseData;
	}

	determineApiFetchMethod(methodName) {
		return this.fetchMethods.find(method => method.name === methodName);
	}

	checkResponseForError(response, responseData) {
		if (!response.ok) {
			throw new ErrorWithClientMessage({
				tech: 'Bad response from server',
				sameForClient: true
			});
		}
	}

	async checkPostcodeValidity(postcode) {
		return this.sendRequest(`https://api.postcodes.io/postcodes/${postcode}/validate`, 'GET');
	}
}

const apiService = new ApiService();

module.exports = apiService;