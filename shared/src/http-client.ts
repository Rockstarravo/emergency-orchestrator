import axios, { AxiosInstance } from 'axios';

/**
 * Simple HTTP client wrapper for service-to-service communication
 */
export class HttpClient {
    private client: AxiosInstance;

    constructor(baseURL: string) {
        this.client = axios.create({
            baseURL,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    async post<T = unknown>(url: string, data: unknown): Promise<T> {
        const response = await this.client.post<T>(url, data);
        return response.data;
    }

    async get<T = unknown>(url: string): Promise<T> {
        const response = await this.client.get<T>(url);
        return response.data;
    }
}
