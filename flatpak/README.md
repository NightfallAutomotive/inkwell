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

Everything Flathub needs is in the repository: an MIT licence, the store listing with screenshots (`io.github.NightfallAutomotive.Inkwell.metainfo.xml`), and a build recipe pinned to the `v1.0.0` release (`flathub/io.github.NightfallAutomotive.Inkwell.yml`). These steps go through your own GitHub account.

### 1. Publish the code and the release tag

```bash
cd ~/Documents/GitHub/inkwell
git push
git push origin v1.0.0
```

Then make the repository public, because Flathub builds from public source. On GitHub, open **NightfallAutomotive/inkwell → Settings → General**, scroll to **Danger Zone**, choose **Change visibility → Public**.

Check that a screenshot opens in your browser: https://raw.githubusercontent.com/NightfallAutomotive/inkwell/v1.0.0/flatpak/screenshots/editor-dark.png

### 2. Test the Flathub build and run its checks

```bash
flatpak run org.flatpak.Builder --force-clean --sandbox --user --install --install-deps-from=flathub \
  --repo=flatpak/repo flatpak/build flatpak/flathub/io.github.NightfallAutomotive.Inkwell.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest flatpak/flathub/io.github.NightfallAutomotive.Inkwell.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo flatpak/repo
```

The build fetches the code from GitHub this time, so step 1 has to be done first. If the lint commands print errors, fix those before submitting.

### 3. Submit

1. Open https://github.com/flathub/flathub and click **Fork**. **Untick** "Copy the main branch only", because the submission goes on the `new-pr` branch.
2. Add the recipe to your fork and push it:
   ```bash
   cd ~/Documents/GitHub
   git clone --branch=new-pr https://github.com/NightfallAutomotive/flathub.git
   cd flathub
   git checkout -b add-inkwell
   cp ../inkwell/flatpak/flathub/io.github.NightfallAutomotive.Inkwell.yml .
   git add io.github.NightfallAutomotive.Inkwell.yml
   git commit -m "Add io.github.NightfallAutomotive.Inkwell"
   git push origin add-inkwell
   ```
3. On GitHub, open a pull request from `add-inkwell` into **flathub/flathub**, with **`new-pr`** as the base branch (not `master`). Title it `Add io.github.NightfallAutomotive.Inkwell`.

### 4. Review

A bot builds Inkwell and posts the result on the pull request. A volunteer reviewer then checks it, which can take from a few days to a few weeks. They may ask why Inkwell needs your home folder. The answer: notes live in a folder you choose, `~/Notes` by default, and Inkwell reads and writes plain Markdown files there.

Once it's accepted, Flathub creates `flathub/io.github.NightfallAutomotive.Inkwell` and invites you to it. Sign in to flathub.org with GitHub to verify the app as yours. It then appears in GNOME Software for everyone.

### Releasing updates later

1. Add a `<release>` entry at the top of the metainfo file.
2. Commit, tag (for example `git tag -a v1.1.0 -m "Inkwell 1.1.0"`), and push the commit and the tag.
3. In the `flathub/io.github.NightfallAutomotive.Inkwell` repository, update `tag:` and `commit:` in the recipe and open a pull request. Flathub's checker bot often opens that pull request for you.
