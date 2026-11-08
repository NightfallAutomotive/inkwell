# Inkwell as a Flatpak

The Flatpak version runs Inkwell in its own window, using the GNOME runtime's built-in web view, so no browser is needed. It shows up in your app menu and in GNOME Software, and Flatpak handles updates and removal.

## Build and install

You only need to do this once. The first build downloads the GNOME 51 runtime and SDK, about 1 GB, unless you already have them.

```bash
# the build tool and the runtime
flatpak install --user flathub org.flatpak.Builder org.gnome.Platform//51 org.gnome.Sdk//51

# build and install Inkwell from this repository
cd ~/Documents/GitHub/inkwell
flatpak run org.flatpak.Builder --user --install --force-clean --install-deps-from=flathub \
  flatpak/build flatpak/io.github.NightfallAutomotive.Inkwell.yml
```

Then open **Inkwell** from your app menu, or run `flatpak run io.github.NightfallAutomotive.Inkwell`.

**To update,** run `git pull` and then the same build command.

**To remove,** run `flatpak uninstall io.github.NightfallAutomotive.Inkwell`. Your notes are untouched.

## A single file to install on another computer

```bash
flatpak run org.flatpak.Builder --user --force-clean --repo=flatpak/repo --install-deps-from=flathub \
  flatpak/build flatpak/io.github.NightfallAutomotive.Inkwell.yml
flatpak build-bundle --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  flatpak/repo inkwell.flatpak io.github.NightfallAutomotive.Inkwell
```

Copy `inkwell.flatpak` to the other computer and install it with `flatpak install --user inkwell.flatpak`, or double-click it to open it in GNOME Software. Flatpak fetches the GNOME runtime from Flathub automatically.

## Differences from `install.sh`

- **Settings live in the Flatpak's own folder,** `~/.var/app/io.github.NightfallAutomotive.Inkwell/config/inkwell/`. That includes the password and the default vault. Your notes still default to `~/Notes`.
- **Commands go through `flatpak run`,** for example:
  ```bash
  flatpak run io.github.NightfallAutomotive.Inkwell --set-password
  flatpak run io.github.NightfallAutomotive.Inkwell --set-vault ~/MyNotes
  ```
- **Inkwell only runs while its window is open.** For online use, where your phone needs Inkwell available all the time, use `./install.sh --service` on the computer that holds your notes instead.
- **Links to websites open in your normal browser.**

## Permissions

| Permission | Why |
| --- | --- |
| Network | Inkwell is a local web server shown in a window. It also loads web pictures in notes and allows optional online access. |
| Home folder | Notes are plain files in `~/Notes` or any folder you choose. |
| Display and GPU | To draw the window. |

## Publishing on Flathub

To appear in GNOME Software for everyone, Inkwell has to be submitted to Flathub. That needs:

- **A real licence** in place of the placeholder in the metainfo file. The skull artwork's licence has to allow redistribution too.
- **Screenshots** in the metainfo file.
- **A tagged release** that the manifest builds from, instead of this local folder.

See https://docs.flathub.org/docs/for-app-authors/submission for the process.
