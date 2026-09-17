# Prospector entry redesign

## Entry screen
- Remove the current introductory panel, key-statistics panel, large Command/Inbox panels, and All Surfaces panel.
- Center a large floating **Prospector** title with **CHIEF BUSINESS OFFICER OPERATING SYSTEM** beneath it.
- Add two floating actions for Command and Inbox, each carrying its real live count in smaller text below the action label.
- Preserve clean-install handling without introducing sample values.

## Navigation
- Remove the separate Home navigation item.
- Make the existing CBO OS brand/status control link back to the Prospector entry screen.
- Keep Command and the remaining operational sections unchanged.

## 3D background
- Replace the pale mineral scene with a darker, high-contrast Three.js spatial environment: dimensional data structures, luminous signal paths, depth fog, particles, and restrained camera movement.
- Keep the scene decorative and non-blocking so all controls remain clickable.
- Respect reduced-motion and existing device fallbacks.

## Verification
- Check the entry screen and navigation at desktop size.
- Confirm both actions open the correct pages, the CBO OS control returns home, the 3D canvas renders, and no browser errors appear.

## Technical details
- Continue using the project’s React Three Fiber integration, which renders through Three.js/WebGL.
- Update route-to-camera station mapping after removing Home from the navigation list.
- Keep all displayed counts sourced from the existing data layer.
