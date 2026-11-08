# Using Inkwell online

Inkwell runs on one computer, which holds your notes. To reach it from your phone, a laptop or anywhere else, keep it running on that computer and give your other devices a safe way in. You don't need to copy your notes anywhere.

You need three things:

1. **A password,** so only you can get in.
2. **Inkwell running all the time** on the computer that holds your notes.
3. **A way in from outside.** Pick one of the three options below.

> Inkwell refuses to accept connections from other machines until a password is set. Without one, anyone who could reach it could read and change your notes.

## 1. Set a password

```bash
inkwell --set-password
```

You type it twice; it's stored as a salted hash in `~/.config/inkwell/config.json`, never as plain text. Use at least 8 characters, and don't reuse a password from elsewhere. Run the same command again any time to change it, which also signs out every device. `inkwell --remove-password` removes it and makes Inkwell local-only again.

After setting it, restart Inkwell. From then on every browser, including the one on this computer, shows a sign-in page. A sign-in lasts 30 days on that device. **Sign out** is in the command palette (`Ctrl+P`).

## 2. Keep Inkwell running

Install it with the background service so it starts when you log in and restarts if it stops:

```bash
./install.sh --service
```

Check on it with `systemctl --user status inkwell`, and read its log with `journalctl --user -u inkwell`.

For a computer that should serve notes even when nobody is logged in, also run `loginctl enable-linger $USER` once.

## 3. Choose a way in

### Option A: Tailscale (recommended)

[Tailscale](https://tailscale.com) makes a private network between your own devices. Inkwell stays invisible to the rest of the internet, you don't touch your router, and you get a proper HTTPS address. It's free for personal use.

1. Install Tailscale on the computer running Inkwell and on your phone and other devices, and sign in to the same account on each.
2. On the Inkwell computer, run:
   ```bash
   tailscale serve --bg 8473
   ```
3. It prints an address like `https://my-pc.tail1234.ts.net`. Open that on any of your devices and sign in.

Only devices signed in to your Tailscale account can reach it. Keep the Inkwell password anyway, in case one of them is lost.

### Option B: Cloudflare Tunnel (public address, no router changes)

Use this if you want Inkwell reachable from any device without installing anything on it, such as a work computer.

For a quick test, run:

```bash
cloudflared tunnel --url http://localhost:8473
```

It prints a random `https://….trycloudflare.com` address that works until you stop it.

For a permanent address on your own domain, follow Cloudflare's guide to [creating a named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/). Point it at `http://localhost:8473`, and run `cloudflared` as a service too.

Anyone who finds the address will see the sign-in page, so a strong password matters here. For a second lock, Cloudflare Access can require your email login before the page even loads.

### Option C: Your own domain with Caddy

Use this if you already run a home server or a VPS and have a domain. [Caddy](https://caddyserver.com) gets and renews the HTTPS certificate for you.

1. Point a DNS record, for example `notes.example.com`, at the server's public address. At home, also forward ports 80 and 443 on your router to that machine.
2. Install Caddy and put this in `/etc/caddy/Caddyfile`:
   ```
   notes.example.com {
       reverse_proxy 127.0.0.1:8473
   }
   ```
3. Run `sudo systemctl reload caddy`, then open `https://notes.example.com`.

Leave Inkwell listening on `127.0.0.1`, its default, so it can only be reached through Caddy and always over HTTPS.

## On your phone

Open your Inkwell address in the phone's browser and sign in. Then add it to the home screen:

- **Android, Chrome:** ⋮ menu → *Add to Home screen*, or *Install app*.
- **iPhone, Safari:** Share → *Add to Home Screen*.

It then opens full screen with the Inkwell icon, like an app.

## Inkwell on your home network only

To use Inkwell from other devices on the same Wi-Fi without any of the above, set a password, then start it listening on all addresses:

```bash
inkwell --host 0.0.0.0
```

Other devices then use `http://<this-computer's-IP>:8473`. This is plain HTTP, so your password and notes cross the network unencrypted. Only do this on a network you trust. Tailscale is the safer choice.

## Good to know

- **Run one Inkwell per vault.** If you also sync the vault folder to a second computer with Syncthing or similar, don't edit the same note in two places at once. Inkwell warns when a note changed on disk while you were editing, but merging is up to you.
- **Backups:** your notes are plain files in the vault folder, and Inkwell's own data is in its `.inkwell` subfolder. Back up the whole vault folder.
- **Too many wrong passwords** (20 within 10 minutes) pause sign-ins for 10 minutes.
- **HTML in notes** stays sandboxed online too. Its scripts can't reach your notes or your sign-in.
