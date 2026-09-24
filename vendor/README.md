# vendor/

`wfreerdp.exe` — FreeRDP's legacy Windows client, used to embed RDP sessions
(the SSH tool's RDP feature shells out to it and embeds its window rather
than reimplementing an RDP client). Binary comes from Chocolatey's
`freerdp.portable` package, SHA256-checked against FreeRDP's official CI
build for that GitHub release tag. Copied verbatim from the `roc_desk` host
repo's own `vendor/wfreerdp.exe` (see that repo's `DESIGN.md` §3.9.1 for the
full history of why this specific client was picked).

`wfreerdp.LICENSE.txt` is FreeRDP's license, shipped alongside the binary.
