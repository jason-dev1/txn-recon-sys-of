const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
	return fetch(`${apiBase}${path}`, options);
}

async function errorMessage(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as { message?: string };
		return data.message || 'Something went wrong. Please try again.';
	} catch {
		return 'Something went wrong. Please try again.';
	}
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await apiFetch(path, signal ? { signal } : undefined);

	if (!response.ok) throw new Error(await errorMessage(response));

	return (await response.json()) as T;
}
