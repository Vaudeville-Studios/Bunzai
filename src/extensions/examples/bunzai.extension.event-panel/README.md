# Scene event panel example

The command subscribes to `scene.opened` for one explicitly selected scene. The panel receives only the safe scene ID summary and renders it through the host's bounded text descriptor. It does not receive prompt or message content.

Review both `events.subscribe` and `ui.panel.set`, then select the exact scene for the subscription grant. The panel contribution declares the event ID. Use the extension manager or the host's event flow to open the selected scene after installing.

The host-rendered panel is available on Desktop and Browser. Terminal can handle the scene subscription but does not provide `ui.panel.set`, so this complete example is unavailable there.
