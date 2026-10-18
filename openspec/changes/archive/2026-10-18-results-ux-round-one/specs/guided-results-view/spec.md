## REMOVED Requirements

### Requirement: The classic results view remains the default

**Reason**: User decision 2026-10-16 (`strides-8c3`) to make the guided view the default. The
behaviour fully reverses, so it is replaced rather than modified.

**Migration**: Links that relied on the bare address showing classic now show guided; append
`?view=classic` for classic. `?view=guide` links keep working, since any value other than exactly
`classic` resolves to the guided view.

## ADDED Requirements

### Requirement: The guided results view is the default

With no view explicitly selected, the guided results view SHALL render. The classic view SHALL be
reachable by an explicit selection that survives a reload and can be shared as a link, and by a
visible control that names both destinations and is operable from the keyboard.

Exactly one `view` parameter whose value is exactly `classic` SHALL select the classic view; every
other address, including an absent, unknown, repeated or differently-cased parameter, SHALL select
the guided view. Selecting the guided view SHALL remove the `view` parameter from the address rather
than write a value, so the default address carries none.

Selecting a view SHALL NOT require a routing library.

#### Scenario: No selection renders the guided view

- **WHEN** the results render with no view explicitly selected, or with an unrecognised selection
- **THEN** the guided results view renders

#### Scenario: An explicit classic selection survives a reload and is shareable

- **WHEN** the reader selects the classic view
- **THEN** the address carries `view=classic`, so reloading or sharing it renders the classic view

#### Scenario: An older guided link still renders the guided view

- **WHEN** the page loads with `?view=guide`
- **THEN** the guided results view renders

#### Scenario: The control is reachable and names both destinations

- **WHEN** the view control renders
- **THEN** it is operable from the keyboard and carries an accessible name identifying both views
