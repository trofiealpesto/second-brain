import { fetchMock } from "cloudflare:test";

// A test must opt into a mock; no fake token may reach a real GitHub service.
fetchMock.activate();
fetchMock.disableNetConnect();
