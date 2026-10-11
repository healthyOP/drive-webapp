run on terminal node server
use http://{ip}:port port = 3000
may have to enable a setting
go to powershell administrator and run: New-NetFirewallRule -DisplayName "Allow TCP 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
to disable this setting after use: Remove-NetFirewallRule -DisplayName "Allow TCP 3000"
