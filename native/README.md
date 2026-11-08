# Ecrin Wallet: native iPhone app

The phone wallet (the same code as ecrinprotocol.app/wallet) wrapped as a real iPhone app with Capacitor. The wallet is
**bundled inside the app**: nothing is loaded from the website at run time, so a problem with the website can never
change the code that holds your keys.

What the native app gets that the home-screen web app can't: the whole screen (no bands at the top or bottom), a real
launch screen, its own storage that isn't tied to Safari, and an App Store listing.

## What you need

- A Mac with **Xcode** (free from the Mac App Store).
- An **Apple Developer account** ($99 a year) at developer.apple.com. For a crypto wallet Apple expects an
  **organisation** account (a company with a D-U-N-S number), not an individual one.
- Node.js 22 or newer.

## Build and run

```sh
cd extension && npm install && node build.mjs     # builds the phone wallet into app/wallet
cd ../native && npm install
npm run ios                                       # copies the wallet in, syncs, opens Xcode
```

In Xcode: select the **App** target, then **Signing & Capabilities**: choose your team. Pick your iPhone (plugged in)
or a simulator and press Run.

After any change to the wallet: `cd extension && node build.mjs`, then `cd ../native && npm run sync`.

## Before submitting to the App Store

1. **Bundle id**: `app.ecrinprotocol.wallet` (in `capacitor.config.json` and Xcode). Change it if you prefer.
2. **Version**: set the version and build number in Xcode to match the wallet (`extension/manifest.json`).
3. **Icon and launch screen** are already in `ios/App/App/Assets.xcassets` (Ecrin icon, dark launch screen with no logo).
4. **Privacy**: the camera is only used for QR codes (the reason is already in `Info.plist`). In App Store Connect,
   the privacy answers are: no data collected, no tracking.
5. **Review notes**: explain that it's a self-custody wallet (the keys never leave the phone), that it runs on test
   networks during the beta, and give a test recovery phrase with test coins so the reviewer can try Send and the Safe.

## Known limits in this first version

- **Face ID** uses iOS directly in the native app (plugin `@capgo/capacitor-native-biometric`): turning it on stores the
  recovery phrase in the iPhone's Keychain (encrypted by the phone, this device only), and unlocking asks Face ID or the
  passcode first. Turning it off deletes the Keychain copy. Run `npm install` in `native/` before `npm run ios` so the
  plugin is included. It has not been tried on a real iPhone yet: test turning it on, unlocking, and turning it off.
- **WalletConnect** needs the app's origin allowed on cloud.reown.com (project settings → allowed domains). If
  connecting to a site fails in the native app, add it there.
- **Push notifications** (money arriving, something leaving the Safe while the app is closed) need the Push plugin and
  an Apple push key: a follow-up.
