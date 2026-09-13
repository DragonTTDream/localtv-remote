# Baseline Report

## Upstream Base Commit
```
436b339 Include winget installation instructions in README
```

## File MD5 Sums
```
58839f708611fe2356a76fbc99d4e490  README.md
750050f2265574d8183916dc2915ce7a  public/control/controller.css
43deb0275c8b2cd32b7704828f82603e  public/control/controller.js
d5a65bd417192ee5a9e92b5c86524879  public/control/index.html
```

## Key Implementation Line Numbers
```
655:    if (e.button === 2) {
661:    if (e.button === 1) {
676:  trackpad.addEventListener('contextmenu', (e) => e.preventDefault());
708:     hits the window edge. While captured we consume movementX/movementY,
727:    const request = trackpad.requestPointerLock();
735:  document.addEventListener('pointerlockchange', () => {
745:    const dx = e.movementX / bounds.width;
```

## Git Diff Stat
```
README.md                     | 32 ++++++++++++++++++
 public/control/controller.css | 41 +++++++++++++++++++++++
 public/control/controller.js  | 75 ++++++++++++++++++++++++++++++++++++++++++-
 public/control/index.html     | 14 ++++++++
 4 files changed, 161 insertions(+), 1 deletion(-)
```