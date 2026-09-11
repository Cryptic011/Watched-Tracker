# UK availability setup

The Edit form has a UK provider selector above “Where you watched it”. A selected provider copies into the saved platform field. Existing platforms are preserved, including previous services and physical media.

Live availability queries JustWatch's public UK catalogue, restricted to `GB`, and requires the exact IMDb identity and correct film/series format. If an older record has no IMDb ID, IMDb suggestions must supply one unique title/year/format match. Subscription, free, adverts, rental and purchase results are labelled separately. Disc offers are excluded. Series results are title-level and may vary by season.

Optional additional fallback: set `TMDB_API_READ_TOKEN` in Supabase → Edge Functions → Secrets using your TMDB API Read Access Token. Never put it in `index.html` or commit it. See https://developer.themoviedb.org/docs/authentication-application and https://supabase.com/docs/guides/functions/secrets. JustWatch lookup works without this token.

If the provider is unreachable or changes its response format, the form offers a JustWatch UK search and manual platform entry. It does not report N/A for failed or unmatched lookups. N/A is offered only after a successful check returns no UK streaming providers. A positive result from either available source takes precedence over an empty result.

Successful lookups are cached on the server for one hour, with a bounded cache of 300 title identities. The endpoint uses the existing account session and maintenance checks. The UI credits JustWatch via TMDB and links to their availability page.

The availability data uses the TMDB API but is not endorsed or certified by TMDB.
