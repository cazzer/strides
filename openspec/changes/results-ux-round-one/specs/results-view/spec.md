## ADDED Requirements

### Requirement: A completed session names the camera views it is missing

When the session's analysis is complete, the results SHALL show, once and above either results
view, which committed camera views (side, front) the session's clips were detected as, and — for
each committed view no clip was detected as — how many measurements are not measured BECAUSE the
session's view is unsuitable for them and that view would be their primary one. It SHALL name those
measurements and offer an action that opens the header's add-a-clip panel.

It SHALL say a missing view is *needed*, never that adding one *will* produce a measurement: a clip
from that view can still fail for other reasons. A measurement that is unmeasured for any reason
other than an unsuitable view SHALL NOT be counted. When no committed view is missing, or no
measurement is unmeasured for that reason, the notice SHALL NOT render. It SHALL NOT add a live
region.

#### Scenario: A front-only session is told what a side clip is needed for

- **WHEN** every clip is detected as front view and trunk lean, overstriding and knee flexion are
  excluded for an unsuitable view
- **THEN** the notice says those measurements need a side-view clip and offers an action that opens
  the add-a-clip panel

#### Scenario: A session with both views says nothing

- **WHEN** at least one clip is detected as side view and at least one as front view
- **THEN** no coverage notice renders

#### Scenario: An exclusion for too little data is not attributed to the camera

- **WHEN** a metric is excluded but its view fit is not unsuitable
- **THEN** it is not counted or named by the notice

### Requirement: Starting over asks before it removes every clip

The control that removes every clip from the session and returns to the clip picker SHALL be
labelled "Start over" and SHALL NOT act on its first activation. Its first activation SHALL reveal,
in place and without a browser dialog, a confirmation naming how many clips will be removed, with a
control that performs the reset and one that cancels. Cancelling SHALL return focus to "Start over".
Both results views SHALL render the same control.

#### Scenario: One click does not discard the session

- **WHEN** the reader activates "Start over" once
- **THEN** every clip is still in the session and a confirmation naming the clip count is shown

#### Scenario: Confirming resets the session

- **WHEN** the reader confirms
- **THEN** every clip is removed and the clip picker is shown

#### Scenario: Cancelling keeps the session

- **WHEN** the reader cancels
- **THEN** every clip is still in the session and focus is on "Start over"

### Requirement: The screen is kept awake while a clip is analysed

While any clip in the session is being analysed (its primary pass sampling or processing, or its
scale pass pending or running), the page SHALL request a screen wake lock where the browser exposes
one, SHALL request it again when the page becomes visible while analysis is still in progress, and
SHALL release it once no clip is being analysed. Where the browser offers no wake lock, or refuses
the request, analysis SHALL proceed unchanged.

On a device whose primary pointer is coarse, while any clip is being analysed, the page SHALL say
that analysis can take a minute or more and that the tab should stay open. That notice SHALL NOT be
a live region. Neither behaviour SHALL change how frames are sampled or detected.

#### Scenario: The lock is held only while analysing

- **WHEN** a clip starts analysing in a browser that offers a wake lock
- **THEN** a screen wake lock is requested, and it is released once every clip is terminal

#### Scenario: No wake lock support is not an error

- **WHEN** the browser exposes no wake lock
- **THEN** analysis runs and completes exactly as before, and no error is shown

#### Scenario: A phone reader is told to expect a wait

- **WHEN** a clip is analysing on a coarse-pointer device
- **THEN** a non-live notice says analysis can take a minute or more and to keep the tab open
