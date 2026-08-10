# Third-party landing decisions

This landing audit did not fetch or integrate the repositories below because the repaired native
implementation has no material deficiency that requires them. Exact revisions recorded by an
earlier pass are preserved as references only; they are not claims that upstream code was copied,
adapted, or independently re-audited here. None is a production dependency.

| Repository | Recorded reference | Landing decision | Reason |
|---|---|---|---|
| Yuka | `10591304811222d6856020d5de129b39ef43b58d` | Reject runtime integration | Native bounded intercept/pursuit is deterministic, small, and stays behind `PlayerIntent`. |
| Theatre.js | `6ea82b938ea49609489f6377ded693ccc6ee8f5b` | Reject runtime integration | The native validated three-shot replay package is sufficient and deterministic. |
| camera-controls | prior pass noted `3.1.2` | Reject for this landing | Native orbit/dolly/focus, exact restore, and input isolation cover the bounded replay-photo need. |
| three-mesh-bvh | no verified revision recorded | Reject for this landing | Segmented bowl and compact mesh AABBs are low-count and have no measured performance/correctness gap. |
| img2threejs | no verified revision recorded | Defer | Asset generation does not address a football, replay, photo, lifecycle, or release deficiency. |
| nflverse-data | 2022–2025 PBP release CSVs, checksums in `reports/play-the-ball/` | Offline calibration only | Anonymous aggregate completion/interception/YAC shape is useful; raw data stays gitignored and no runtime/build network path exists. |

The authoritative simulation remains native TypeScript. Third-party objects may not own movement,
save state, replay state, simulation RNG, or `PlayerIntent` production without a separate design
and validation pass.
