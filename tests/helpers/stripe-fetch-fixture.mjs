// Loaded only by the local browser fixture. No Stripe network requests leave it.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== 'https://api.stripe.com') return fetchOriginal(input, init);
  return fetchOriginal(`http://127.0.0.1:54399/_test/stripe${url.pathname}${url.search}`, init);
};
