# UK availability setup

The Edit form has a UK provider selector above “Where you watched it”. A selected provider copies into the saved platform field. Existing platforms are preserved, including previous services and physical media.

Live availability uses TMDB's JustWatch-powered watch-provider API, restricted to `GB`. Subscription, free, adverts, rental and purchase results are labelled separately. Series results are title-level and may vary by season. IMDb identity is preferred; ambiguous title matches are not accepted.

Set `TMDB_API_READ_TOKEN` in Supabase → Edge Functions → Secrets using your TMDB API Read Access Token. Never put it in `index.html` or commit it. See https://developer.themoviedb.org/docs/authentication-application and https://supabase.com/docs/guides/functions/secrets.

Without a configured token the form offers a JustWatch UK search and manual platform entry. It does not report N/A for an unconfigured, failed or unmatched lookup. N/A is offered only after a successful check returns no UK providers.

Successful lookups are cached on the server for one hour, with a bounded cache of 300 title identities. The endpoint uses the existing account session and maintenance checks. The UI credits JustWatch via TMDB and links to their availability page.

The availability data uses the TMDB API but is not endorsed or certified by TMDB.
