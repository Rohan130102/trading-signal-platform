# Mobile audit

Everything below was run on 6 November 2026, on one Apple Silicon Mac with 8 GB of memory and no Xcode. Anything not run says so.

## Readiness

**The app works: tested end to end on Android, including a real installed APK, and checked by hand on a real iPhone. It is not ready for
real subscribers.** No real push notification has reached any device, it has never been installed on iPhone outside Expo Go, and legal
review has not happened.

| Question                                          | Answer                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Does it work on Android against the real backend? | **Yes**, on an Android 12 emulator, in Expo Go and as a real installed APK                            |
| Does it work on iPhone?                           | **In Expo Go, yes**, as far as five hand checks by the owner went. See [iPhone](#iphone)              |
| Does an installable Android build compile?        | **Yes**, in CI, and it runs on the emulator. It is signed with a debug key, so it is for testing only |
| Does an installable iOS build compile?            | **Not known.** The `ios-build` workflow has not been run                                              |
| Do real push notifications arrive?                | **Not known.** Needs an Expo project and credentials only the owner can create                        |
| Is the server side of push tested?                | **Yes**, against a local stand-in for Expo's service                                                  |
| Ready for store submission?                       | **No.** Needs the owner's accounts, a production API and legal review                                 |

## What ran

| Gate                                                                    | Result                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript across all four packages                                     | Pass                                                                                                                                              |
| ESLint, zero warnings allowed                                           | Pass                                                                                                                                              |
| Prettier                                                                | Pass                                                                                                                                              |
| Shared logic tests                                                      | **154 of 154**                                                                                                                                    |
| API integration tests, including 32 new ones for native clients         | **178 of 178**                                                                                                                                    |
| Web end-to-end tests, confirming the shared-code refactor broke nothing | **77 of 77**                                                                                                                                      |
| Mobile component and logic tests                                        | **61 of 61**                                                                                                                                      |
| Emulator journeys in Expo Go, against a real API, worker and database   | **22 of 22**, before the keyboard and iPhone fixes in `ffa576b`. Afterwards only keyboard and large-text were rerun here, not the two size sweeps |
| The same journeys in a real installed APK, except the two size sweeps   | **20 of 20** on the fixed build. The first APK scored 18 of 20: a real keyboard bug, listed below, and a false alarm in a layout check            |
| Expo project health check                                               | 20 of 20                                                                                                                                          |
| JavaScript bundle for Android and iOS, production settings              | Pass                                                                                                                                              |
| Secret scan of tracked files and full history, including Gitleaks in CI | Clean. Two false positives are recorded by fingerprint in `.gitleaksignore`: made-up test keys and a throwaway load-test password                 |
| `npm audit --omit=dev`, high or critical                                | **0**                                                                                                                                             |
| `npm audit --omit=dev`, moderate or low                                 | 22, all `minimatch` and `deepmerge` in Expo's and Jest's command-line tools. No fix exists without downgrading Expo. None of it ships in the app  |

## iPhone

The owner ran the app on their own iPhone in Expo Go, over Wi-Fi to the development server, and reported that all of these worked:

1. The composer's Review button stays above the number pad.
2. The action sheet's button stays above the number pad, and swiping down closes the sheet.
3. Creating a subscriber shows a temporary password.
4. A new subscriber's first sign-in asks for a new password without retyping the temporary one.
5. A signal published from the web appears by itself, with the Live label showing, and a signal published while the phone is locked appears once after unlocking.

6. After a reported bug and fix, the close button on the composer works, where before it sat under the status bar.

**Item 1 and the keyboard part of item 2 were checked before the keyboard handling was last changed, so they need checking again on iPhone.** The bundler log showed no errors during this. These were hand checks reported by the owner, not automated tests, and they cover only the items above. Expo Go on iPhone also requires the phone and this computer to be signed in to the same Expo account.

## Not run

| Gap                                        | Why                                                                                                                                                                                              | What to do                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **A real push notification on any device** | Needs an Expo project, Firebase and Apple credentials                                                                                                                                            | See [MOBILE.md](MOBILE.md). Then test delivery, tapping from closed, and hidden previews on real phones |
| **Tapping a notification**                 | Same. Logic is unit tested, and deep links are tested through the system's own link handling                                                                                                     | As above                                                                                                |
| **An installed iOS build**                 | Needs Xcode or the `ios-build` workflow, and an Apple Developer account for a real phone                                                                                                         | Run the workflow, then TestFlight                                                                       |
| **Most iPhone screens**                    | Only the checks above were done by hand. The "iPhone size" runs are Android drawing at those logical sizes, which checks layout only                                                             | A full pass on a real iPhone                                                                            |
| **The shared APK while signed in**         | It reached the backend over the public tunnel, showed the disclosures and answered a wrong password, but no account signed in through it, and a live update through the tunnel was not confirmed | Sign in on it. The Live label should turn green                                                         |
| **An Android phone**                       | Only the emulator was available                                                                                                                                                                  | Install the test APK on a real phone                                                                    |
| **Android 13 and later**                   | The only system image here is Android 12, which does not ask for notification permission                                                                                                         | Test the permission prompt on a current phone                                                           |
| **Slow networks, low-end phones, battery** | Emulator on a laptop                                                                                                                                                                             | Real devices on mobile data                                                                             |
| **Screen readers**                         | Labels and roles are set, and checked in the accessibility tree. No person has used it                                                                                                           | TalkBack and VoiceOver pass                                                                             |
| **Live delivery time on a phone**          | The driver reads the screen too slowly to give a meaningful number                                                                                                                               | Measure on a real device                                                                                |
| **A store review**                         | Needs the owner's accounts                                                                                                                                                                       | See [MOBILE.md](MOBILE.md)                                                                              |

## Defects found and fixed

| Severity | Found by                 | Defect                                                                                                                                                                                                                       | Fix                                                                                                                             |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Emulator journey         | **Every list screen was blank on Android.** On Android a scroll view renders inside its refresh control, and my wrapper dropped it. Typecheck and unit tests could not see this                                              | The wrapper forwards everything                                                                                                 |
| Critical | Starting the app         | Two versions of React in the workspace, which crashes a React Native app                                                                                                                                                     | One exact version across web and mobile                                                                                         |
| High     | Emulator journey         | The app crashed at launch in Expo Go: the check for "am I in Expo Go" gave the wrong answer, so the push library loaded                                                                                                      | Uses Expo's own check                                                                                                           |
| High     | Emulator journey         | Signing out crashed, because the account screen was still on screen for a moment with no account                                                                                                                             | Renders nothing during that moment                                                                                              |
| High     | Emulator journey         | A half-written signal was lost on reopening the composer: an empty form overwrote the saved one before it had been read                                                                                                      | Nothing saves until restoring has finished                                                                                      |
| High     | Emulator journey         | On Android the action sheets' buttons sat behind the keyboard, and the window did not resize                                                                                                                                 | Fixed the window setting, and moved every action button to a footer above the keyboard                                          |
| High     | Real APK journey         | **In an installed Android build the keyboard covered the buttons below it**, because the window does not resize as it does in Expo Go. Testing only in Expo Go could not have shown this                                     | Measures how much the keyboard actually covers. Passes on the fixed APK, and checked in screenshots                             |
| High     | Owner, on a real iPhone  | **The composer could not be closed on iPhone.** A native modal sits outside the app's root view and got no safe-area insets, so its top bar went under the status bar. Android does not show this                            | Modal screens have their own safe area. Confirmed by the owner on their iPhone, and a test checks that every modal route has it |
| Medium   | Developer review         | On iPhone, toasts raised inside a native modal stayed hidden behind it, such as "Draft saved"                                                                                                                                | Modal screens have their own toasts. Not separately checked on iPhone                                                           |
| High     | Developer review         | **Recovery codes could vanish before being saved.** Two-step turns on the moment the code is accepted, so the next account refresh moved on from the only screen that shows them. Going off to paste them would trigger that | The screen stays until "I have saved them" is pressed                                                                           |
| High     | Developer review         | **Alerts stopped silently after a forced sign-out**, such as a password reset, because the device registration went with the session                                                                                         | Re-registers on the next start, unless the person turned alerts off                                                             |
| High     | Developer review         | iOS: the standard keyboard-avoiding view measures from its parent, so it would have come up short under a header or in a sheet. **Confirmed on a real iPhone by the owner**                                                  | Measures from the bottom of the screen                                                                                          |
| Medium   | UI review                | A cancelled signal was headed "Closed: T-0005" in the feed, on web too                                                                                                                                                       | "Cancelled:" and "Expired:", shared by both                                                                                     |
| Medium   | Screen sweep, large text | Tab labels were cut off with larger system text                                                                                                                                                                              | Labels no longer scale, because the icons say the same                                                                          |
| Medium   | Screen sweep             | Toggle switches were 39 dp tall                                                                                                                                                                                              | The whole row is the target                                                                                                     |
| Medium   | First-time user review   | A first sign-in asked for the temporary password again, seconds after typing it                                                                                                                                              | Remembered in memory for that one step                                                                                          |
| Medium   | UI review                | An alert banner announced what was already on screen, including what the administrator had just done                                                                                                                         | Quiet on the same trade, in the feed and in the composer, except for priority                                                   |
| Medium   | Security review          | Android backups were allowed, and the app declared a Face ID use it does not have                                                                                                                                            | Both removed                                                                                                                    |
| Medium   | Architect review         | Response types and date formatting were copied between apps                                                                                                                                                                  | Moved to the shared package                                                                                                     |
| Low      | UI review                | Badges sat above the line, and targets were smaller than other levels                                                                                                                                                        | Aligned and consistent                                                                                                          |
| Low      | Developer review         | All icon fonts shipped, and the "Published" screen kept polling after it had finished                                                                                                                                        | One font, and polling stops                                                                                                     |
| Low      | Tests                    | The test suite's offline check could not actually cut a connection, because `adb reverse` ignores Wi-Fi                                                                                                                      | A proxy in the test server really drops every socket                                                                            |

No Critical or High defect is known to be open. One High fix depends on something that could not run here: the push re-registration, which is covered by logic tests only.

## The five reviews

**Senior developer.** Read every screen and library file against how it behaves on a device. Found the recovery-code race, the silent loss of alerts and the leftover polling. Remaining: Expo messages are sent one per request. That is simple and correct but will not suit tens of thousands of devices, and the client limits are unmeasured.

**Software architect.** The app owns no trade logic: `composeSignal`, `previewExit`, `trailStopPrice`, formatting and validation come from `packages/domain`, and web now uses the same functions, so a preview and the server cannot disagree. Native push is a channel in the existing pipeline, not a parallel one. Bearer sessions use the same table and guard as cookies. Remaining: no offline cache of private data by design, so a cold start with no network shows an error rather than old signals. That is the right default for trading, and worth confirming with you.

**QA engineer.** Journeys drive the real app through the system's accessibility tree, with no test hooks compiled in. They cover wrong passwords, first sign-in for both roles, live delivery with no refresh, a connection really being cut and caught up exactly once and in order, backgrounding, deep links, expiry mid-session, renewal, revocation, every main trade action with exact server-side checks on the money, duplicate protection, invalid levels, drafts, and subscriber management. Remaining: everything in [Not run](#not-run).

**UI/UX expert.** Reviewed screenshots of every major screen in dark and light, at six sizes, and with large text. Findings are in the table above. The checks also assert that nothing runs off screen and that touch targets are at least 40 dp. Remaining: dates are typed as `YYYY-MM-DD` where a date picker would be friendlier (Medium, open), the status bar dims behind sheets on Android (Low, open), and there is no haptic or motion review on real hardware.

**First-time user.** Walked through as a subscriber and as an administrator with no prior knowledge. A new subscriber sees why to change their password, an empty feed that explains itself, and a notification prompt only after arriving. An administrator can publish from the first screen in about four taps. Rough edges: "Desk" and "Trades" are not obviously different at first, and instruments can only be added on the web, which the app explains under More.

## Open items

| Severity | Item                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| Medium   | Date fields are typed rather than picked                                         |
| Medium   | Expo messages are not batched                                                    |
| Medium   | No self-service account deletion. May be required by the stores                  |
| Medium   | No screen reader pass                                                            |
| Low      | Status bar dims behind sheets on Android                                         |
| Low      | The exit-time override is on the web only. On a phone an exit is recorded as now |

## Blockers that are yours

1. **Legal review.** Unchanged from [FINAL_AUDIT.md](FINAL_AUDIT.md): the placeholder legal text and regulatory position must be resolved before real subscribers. A native app adds store policies to that.
2. **Accounts and credentials:** Expo, Firebase, Apple Developer, Google Play. See [MOBILE.md](MOBILE.md).
3. **A production HTTPS API.** The deployment files remain unexercised.
4. **More testing on real phones**, including a full pass on iPhone and a first run on an Android phone.

## CI status

All five checks passed on `ffa576b`, the last commit to change code: secret scan, lint, types, unit and integration tests, web end-to-end tests, mobile validation, and the Android APK. The commit after it changes only documentation and skips CI to save minutes.

`main` shows a failure from a formatting error in the baseline commit. This branch fixes it, so merging clears it. The `ios-build` workflow has not been run.
