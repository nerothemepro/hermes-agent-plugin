# HerSocial Video And Publish Delegates

`start-hersocial-marketing-video.sh` is the deterministic operator entry point for
`sdtk-marketing video` and `sdtk-marketing publish`. It loads the same two environment sources as
the attended HerSocial post runner, then invokes the global toolkit with a clean environment.

- Secrets remain in `/opt/data/hermes-profiles/hersocial/.env` or the `0600`
  `/opt/data/hermes/control-plane/secrets/mkt-digest.env` file.
- Delegate templates and rendered assets are runtime configuration; they are not committed here.
- `publish` without `--approve <exact-payload-sha>` is prepare-only and cannot upload.
- Tutorial/review workflows require an explicit real capture passed with `--capture`; Remotion
  composites that capture and never synthesizes a terminal session.
