# Replay photo mode

Photo mode is reachable only while the existing transform replay is active. `Game` exposes a
small adapter surface for UI/device bindings: enter/exit, bounded orbit, dolly, and focus. The
controller owns no simulation state and cannot produce `PlayerIntent`; the replay branch already
disables touch gameplay input and bypasses `Match.tick()`.

Entering saves position, quaternion, up vector, and FOV. Exiting restores those values exactly and
updates the projection matrix. Replay poses remain frozen at the current transform-buffer frame
while the camera orbits; no replay path re-simulates football. Collision proxies come from compact
visible stadium meshes plus segmented bowl-perimeter boxes. Giant merged venue boxes are rejected,
instanced structures are expanded per instance, and all proxies clear on unload. Touch gestures in
photo mode route only to the camera. The low-count AABB path has no measured need for a BVH.
