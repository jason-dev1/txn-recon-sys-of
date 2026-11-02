export const logger = {
	error(event: string): void {
		console.error(JSON.stringify({ level: 'error', event }));
	},
};
