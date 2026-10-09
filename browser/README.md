# Browser download guard

This optional browser surface sends a bounded `download-preflight` fact request
through browser native messaging. The native host reads mounted-volume facts and
returns `allow`, `redirect`, `insufficient-space`, or `observation-required`.

The extension is advisory. It does not open a network listener, receive an
arbitrary filesystem path, cancel a download, or rewrite a browser destination.
Those actions require a separate browser-specific approval and host contract.

The native host name is `com.rnk.enterprise.optimizer`. A platform installer
must place a browser-specific native-messaging manifest with an exact extension
origin before the extension can connect.
