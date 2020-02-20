const FRONTEND_ROOT = 'http://localhost:3000';
const FRONTEND_ADMIN_ROOT = 'http://localhost:3001';
const VALID_ACCOUNT_TYPES = [
	{
		id: 'business',
		public: true
	}, {
		id: 'organisation',
		public: true
	}, {
		id: 'individual',
		public: true
	}, {
		id: 'admin',
		public: false,
		hasAdminPriveleges: true
	}, {
		id: 'dev',
		public: false,
		hasAdminPriveleges: true,
		hasDevPriveleges: true
	}
];

module.exports = {
	environment: 'test',
	frontendRoot: FRONTEND_ROOT,
	acceptedOrigins: [FRONTEND_ROOT, FRONTEND_ADMIN_ROOT],
	numSaltRounds: 12,
	users: {
		accountTypes: VALID_ACCOUNT_TYPES,
		name: {
			maxLength: 64
		},
		email: {
			maxLength: 128
		},
		password: {
			minLength: 4,
			maxLength: 64
		},
		statuses: ['pending', 'active', 'deactivated']
	},
	offers: {
		description: {
			maxLength: 200
		},
		dealValue: {
			maxLength: 20
		}
	},
	email: {
		displayName: 'ESTA'
	},
	database: {
		name: 'esta-project'
	}
};