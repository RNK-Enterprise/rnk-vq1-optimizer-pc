# Browser download guard

This optional browser surface sends a bounded `download-preflight` fact request
through browser native messaging. The native host reads mounted-volume facts and
returns `allow`, `redirect`, `insufficient-space`, or `observation-required`.

The extension is advisory by default. It does not open a network listener,
receive an arbitrary filesystem path, or rewrite a browser destination. A
caller may explicitly set `enforceStates` to `['redirect']`,
`['insufficient-space']`, or both; that browser-specific policy cancels a
download during filename determination when the native preflight returns the
selected state. Cancellation is never enabled implicitly. Cross-volume
destination redirection remains outside this authority until a browser and
host contract can prove a safe target path.

The native host name is `com.rnk.enterprise.optimizer`. A platform installer
must place a browser-specific native-messaging manifest with an exact extension
origin before the extension can connect.
