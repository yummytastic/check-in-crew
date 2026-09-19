# Check-In Crew

## Public policies

The source for the public policy pages is in [`docs/site`](docs/site). GitHub Pages deploys it through [`.github/workflows/pages.yml`](.github/workflows/pages.yml) once this project is connected to a GitHub repository with Pages set to **GitHub Actions**. Add the resulting `/privacy/` and `/terms/` HTTPS URLs to the Devvit App Details page before submission.

Run monthly accountability threads and recurring community posts with automatic scheduling, editable upcoming posts, and volunteer hosts who can manage their series without being moderators.

Check-In Crew handles posting while your community supplies the conversation. Run separate groups alongside one another, credit their hosts, and customise upcoming posts for a holiday, a special prompt or a change of topic. Participants join through ordinary Reddit comments.

## Choose a series

A **series** is a group of posts with its own schedule, templates and maintainers. **Maximum series** in app settings defaults to 10 and accepts 1–60. Paused series count; archived series do not. Higher limits can slow the dashboard and increase scheduled posting work, especially with hourly schedules or large preview windows. Lowering the limit does not remove or pause existing series; creation and restoration require a free slot.

| Type                       | How it works                                                                                                                                   | Example                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Monthly series**         | A start post and daily check-in on day one, daily check-ins through the month, and a finish post on the last day. Repeats each calendar month. | Accountability challenges, reading groups or community projects. |
| **Simple recurring posts** | One template repeated daily, weekly or on an **Other** schedule, with individually editable upcoming posts.                                    | Weekly goal setting, daily discussion or monthly reminders.      |

Monthly series follow actual calendar months, including leap years. The finish post replaces the final day's check-in. Default titles use “30 Day Accountability Challenge”; edit them to suit your community.

## Get started

1. Open the app's community settings and review the default titles, bodies, community note and host credit.
2. From the subreddit menu, choose **Open Check-In Crew dashboard**, then **Open dashboard** on the public home.
3. Configure an existing series or select **Create a new series**. Choose its type and display name. New series start paused.
4. Set its posting time, timezone and highlighting. For an **Other** schedule, complete **Choose schedule** after creation.
5. Review the titles and bodies. Leave **Use default** checked to follow app settings, or uncheck it to customise this series.
6. Add hosts and assign maintainer access if volunteers will manage it.
7. Preview upcoming posts, save any edits, then select **Resume** when ready.

New installations include paused monthly examples named **EU** and **US**, initially scheduled for 08:00 Europe/London and 20:00 America/New_York. Rename and configure them for your community.

The dashboard is a locked Reddit post. Locking prevents comments; it does not make the post private. Management access is checked separately. Open the full dashboard for the complete controls on desktop or mobile.

## Public home and community tools

When the calculator is disabled, the unopened post shows the same compact public home to everyone. When enabled, it opens directly to the calculator, with **Open dashboard** at the bottom right for accounts with management access. Other visitors can select **About Check-In Crew** for the explanation and access information. Accounts with server-confirmed management access see **Open dashboard**, which opens their existing full dashboard. Signed-out and unassigned visitors see an explanation and **Check my access**, which rechecks existing permissions without requesting or granting access. Management controls remain hidden during loading, failed checks and public use. Network failures offer a retry rather than incorrectly saying the visitor has no permission.

Moderators can enable **Community tools → Enable calorie needs and BMI calculator** in app settings. It is **off by default**. When enabled, anyone who can view the post can use it without signing in or obtaining management access. When disabled, the public home retains its explanation, community link and access notice.

The calculator accepts age, formula sex, height, weight and activity. Height and weight units are independent: choose centimetres or feet/inches for height, and kilograms, pounds, or stone/pounds for weight. Switching units converts entered measurements without changing the calculation; stone must be whole, with the remaining pounds from 0 to under 14. **Calculate** replaces the form with estimated maintenance calories and BMI to one decimal place. **Edit details**, **Back to home** and the help views retain the current inputs. BMI has no categories, colour scale, target ranges or weight recommendations; there are no calorie-deficit prescriptions.

All measurements and results remain in memory on the device. The calculator does not send them to the server, write them to browser storage, log them or associate them with Reddit accounts. Reloading starts a fresh calculator. Public network responses contain only the community name, calculator availability and an access outcome; source navigation contains no measurements.

The public flow is designed for the embedded post, with separate home, inputs, results and help screens. Local browser checks cover widths from 320–720 pixels at heights of 400 and 512 pixels. Essential navigation remains visible; scrolling is available for enlarged text or smaller windows. Reddit mobile clients still require playtesting on-device.

### Calculation and sources

Uses the simplified [Mifflin–St Jeor resting-energy equation](https://pubmed.ncbi.nlm.nih.gov/2305711/): `10 × kg + 6.25 × cm − 5 × age + constant`, with +5 for the male equation or −161 for the female equation. The sex choice selects a study-derived equation, not a gender label. The original study covered ages 19–78; body composition, health and hormone treatment may affect applicability. This tool is for adults 18+ and is not designed for pregnancy, breastfeeding or clinical nutrition.

Resting energy is multiplied by 1.2, 1.375, 1.55, 1.725 or 1.9 according to the selected activity level. These conventional estimates are documented in [Orgain Healthcare’s sports-nutrition Q&A, question 2](https://healthcare.orgain.com/media/webinar/qa/MakingGoodAthletesGreatQ_A.pdf); they are approximations, not measured daily expenditure. Activity descriptions are original copy covering daily movement, work and exercise together. Moderate activity pairs movement throughout the day with purposeful exercise 3–5 days a week; the highest choices describe sustained high workloads, not just short workouts. Activity help explains that these estimate maintenance and that a calorie deficit does not determine activity level. These are practical selection guides rather than exact clinical thresholds; [FAO’s discussion of whole-day activity](https://www.fao.org/4/y5686e/y5686e07.htm) provides further context and uses its own classification ranges.

[BMI is calculated as kg divided by metres squared](https://www.cdc.gov/growth-chart-training/hcp/using-bmi/body-mass-index.html), independently of the calorie estimate. Results are rounded only for display: whole kcal/day and one decimal place for BMI.

## Set your own flair

**Set flair** appears at the bottom right of the calculator/public home, immediately before **Open dashboard** or **About Check-In Crew**. From the embedded post, it opens its own full-screen panel, like the dashboard, with no nested app scrollbar; Back closes the panel. It never copies calculator inputs and has no BMI or calorie components. Sign in to Reddit to use it; series-management access is not required.

Choose a named format, fill only the fields it uses, and check the live preview. **Review flair → Apply flair** explicitly replaces your current public flair in this community. The current text is shown first. Empty optional fields and attached labels such as `SW:` disappear; the final text must fit 64 characters. Weight and height fields append selected units; enter the measurement in those units (the flair form labels values, rather than converting them). Reddit may change the styling to the configured template.

In app settings:

- **Community tools → Enable Set flair** controls availability; enabled by default. It is hidden and cannot run when Reddit user flair is disabled for the community.
- **Allow Set flair when Reddit self-assignment is off** is off by default. Turn it on only when the community deliberately wants members to receive flair through this app while Reddit’s normal self-assignment setting remains off. It never overrides Reddit’s separate user-flair enablement setting or uses moderator-only templates.
- **Allow Set flair to replace existing flair** is off by default. Reddit’s public API does not reveal the template attached to a member’s existing flair, so Check-In Crew protects all existing flair unless moderators explicitly opt in. This means a newly flaired member may need a moderator to clear or change an existing flair before using this tool.
- **Flair field 1–8** defines each member-facing label, input type (short text, whole number, weight, height, disabled), optional help, and whether it is required. A blank label also disables a field. Defaults are age, gender, starting/current/goal weight, height and personal text, with field 8 unused.
- **Flair format 1–5** defines each name and format using `{flair1}` through `{flair8}`. Defaults are Full stats, Weight stats, Starting → current, Current → goal, and Personal text. Blank names disable formats. Settings show a default example; the member form previews the actual result. Remove references to disabled fields before using a format.
- **User flair — Reddit template** optionally specifies a Reddit template ID. Blank selects the first suitable non-moderator text template: member-editable while Reddit self-assignment is on, or any non-moderator text template when the app-assignment setting above is enabled. Moderator-only and emoji-only templates are rejected.

The current-flair API exposes text and CSS class, but not its template ID. The app therefore does not guess whether an existing flair is safe to replace. It protects every existing flair by default. If moderators opt into replacement, exact text matching a moderator-only template remains protected; however, this setting should be used only where that remaining ambiguity is acceptable.

Only the authenticated account in the current community can be updated. The app rechecks feature availability, bans, templates, current flair and submitted content when Apply is selected. If the existing flair or generated preview changed, members must reopen the form. Inputs stay in browser memory until Apply; Apply sends only fields used by the selected format, the preview and the previous flair to the server. The app does not persist these details or log them. Reddit stores the resulting public flair; users can replace or remove it through Reddit’s flair controls. Automated checks use mock Reddit calls; actual flair changes require a playtest with a suitable Reddit template.

## Maintainers and hosts

The native **Check-In Crew** subreddit menu is a small management hub: **Open dashboard**, **View publication history**, **Emergency pause selected series**, and moderator-only **Assign volunteer maintainers** and **Fix a missing publication record**. Creation, scheduling, templates, host credits and manual posting are in the full dashboard. Emergency pause works without loading the dashboard; resuming is done there after review. The history view lists publication records, not general diagnostic logs.

**Maintainers** can manage an assigned series. **Hosts** receive credit in its posts. Someone can be both, but a host credit alone does not grant access.

| Role                                      | Access                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderator with **Everything** permissions | Manage all series, create and rename them, assign maintainers and hosts, and choose sticky placement.                                       |
| Assigned maintainer                       | Manage their series' schedule, pause/resume state, templates and individual future posts. View history and use manual posting when enabled. |
| Host credited by username                 | Receive a credit, without management access unless also assigned as a maintainer.                                                           |

### Grant or remove access

Open a series in the dashboard and choose **People & access**. Enter a Reddit username and select **Add as host** or **Add as maintainer**. The list has separate controls for each role; someone can have both. Only moderators with Everything permissions can change this list; maintainers can view it. Volunteers do not need to become moderators.

Select **Remove maintainer** to revoke access, then **Save people & access**. Tick **Remove access at end of month** to expire a maintainer's access at the end of the current month in the series timezone; the exact date is displayed. Unchecked means access continues until removed. Previously saved expiry dates are displayed and preserved unless changed. Host credit and access are independent: removing or expiring access does not remove an explicitly assigned host role. Changes are saved together, and Reddit accounts are verified on save. The native **Assign volunteer maintainers** form remains available; its expiry applies to everyone in that save.

Access is tied to verified Reddit account IDs and checked on each request. Non-admin accounts are also checked against the community ban list. Maintainers cannot grant permissions or manage another series. Moderators without Everything permissions can be assigned as maintainers too.

### Add or remove hosts

In **People & access**, use **Add host** or **Remove host** beside a person. The **↑ / ↓** buttons change the order of names in generated host credits. **Save people & access** applies the changes. People with neither role disappear after saving. Removing all host roles uses a general volunteer-team credit when the post template includes it. Removing a host changes future generated posts, not published posts.

The list saved through the dashboard becomes the default roster for subsequent months unless a month already has an explicit selection. Without a saved roster or monthly selection, eligible maintainers are credited. Review credits separately when changing access: credit-only usernames do not depend on management permission.

Monthly series use the default format `Hosted by {hosts}.` Change it in the Monthly series app settings or uncheck **Use default host credit** to customise one series. Use `{host_credit_monthly}` in monthly post bodies. Simple recurring posts keep host credit off by default; enable **Include host credit in generated posts** for that series to use the separate simple-post default from app settings, and use `{host_credit_simple}` in its body. Credit formats support `{hosts}`, `{series}` and `{month}`.

Posts are authored by the Check-In Crew app account. The app does not post through volunteers' personal accounts.

## Recurring schedules

Simple recurring posts offer **Daily**, **Weekly** and **Other**. Select **Other** to see the named repeat patterns and their relevant timing fields:

- Every X days, weeks or months, with intervals from 1 to 120.
- One or more selected weekdays in each scheduled week.
- A numbered day of the month, including the first day.
- The last day of the month.
- The first, second, third, fourth or last occurrence of a weekday, such as the last Friday.
- Every X hours when a moderator enables **Allow hourly schedules** in app settings. This is off by default, and the hourly choice is hidden until enabled. An existing hourly schedule shows an explanation if the setting has since been turned off.

For a day missing from a shorter month, choose whether to skip that month or use its last day. The schedule editor also offers an end date or a maximum number of scheduled occurrences. This count limits scheduled opportunities, not successful publications; pausing does not extend it. Choose **Until paused** for ongoing posting.

### Change a schedule

Select **Change schedule**, choose a future start date and time, and adjust the pattern. Use **Preview schedule** to inspect dates, then **Apply schedule** and confirm. The previous pattern continues until the selected change time, subject to the series' pause state. Use this editor to change simple-series times and timezones too.

Published posts remain in history. Custom edits that no longer match appear under **Unscheduled drafts** for moving or discarding. The current move dialog accepts a date with one occurrence; it cannot select between several hourly occurrences on that date.

Series type is fixed at creation. Create a separate series to switch between monthly and simple posts. Internal IDs are generated automatically and stay fixed; moderators can change display names.

### How far ahead can I edit?

| App setting                  | Default | Range |
| ---------------------------- | ------- | ----- |
| **Daily posts shown ahead**  | 15      | 1–60  |
| **Weekly posts shown ahead** | 5       | 1–60  |
| **Other posts shown ahead**  | 5       | 1–60  |

These settings control the dashboard window. They do not limit posting or remove saved edits. As an occurrence is published or its time passes, another enters the window, including across month and year boundaries.

**View month** changes monthly-series posts and posting history. Recurring posts always show their upcoming window from the present. The year list shows the previous, current and next year and updates when the dashboard loads. **This month** returns to the current month.

## Automatic posting and pausing

Check-In Crew uses Reddit's app scheduler. No AutoModerator trigger posts are needed. An installed build runs its automatic posting on Reddit without your computer remaining open.

The scheduler checks every five minutes, so posts can appear shortly after the selected time. Use a timezone such as `Europe/London` or `America/New_York` for seasonal clock changes. Hourly intervals measure elapsed hours, so their local time can shift when clocks change.

Pause or resume one series, or select several and use **Pause selected** or **Resume selected**. An already-started publication may finish after a pause.

There is no general backfill of missed dates. Monthly series and simple daily/weekly series that have not been changed through the schedule editor can catch up today's missing posts when resumed later that day. Rules saved through **Change schedule** use a ten-minute due window and skip older missed occurrences.

## Archive and restore

Moderators can select **Archive series** on a current series and confirm. Archiving stops automatic and manual posting, removes the series from the current dashboard and frees a slot under **Maximum series**. An already-started publication may still finish.

Open **Archived series** to see archived entries separately and review publication history for the selected month. Schedules, templates, hosts, maintainer assignments, individual edits and publication records are retained. Assigned maintainers can still view their archived series' history; moderators can review or revoke access through the native hub.

Select **Restore series** to bring it back with the same ID and saved data. Restoration requires a free slot and always leaves the series paused. Review its dates and host/access assignments before resuming. Archiving does not extend schedule end dates or maintainer expiry dates.

### Permanent deletion — exceptional use

Archiving is the normal way to retire a series. Deletion cannot be undone.

- **Individual posts:** use **Delete post** beside a recorded publication in the dashboard. The confirmation shows the actual Reddit title and scheduled date; type `DELETE` to proceed. Only posts created by this app in this community can be deleted. A minimal **Deleted** record prevents the scheduler from recreating the occurrence; its saved individual title/body edits are erased, including copies in older configuration snapshots. Shared templates remain available for other occurrences.
- **Maintainer permission:** moderators with Everything permissions can delete individual posts. **Danger zone → Allow maintainers to delete individual posts** is off by default. When enabled, maintainers can delete recorded posts in their assigned series, including archived ones. Access and the setting are checked again when confirming.
- **Series data:** moderators can open **Archived series → Permanently delete series**, type the exact display name, and leave **Also delete its published posts** unchecked. This starts irreversible background cleanup of the series data and its stored publication history. Reddit posts remain.
- **Series and published posts:** check **Also delete its published posts** before confirming. This is moderator-only. The series remains archived during the cooldown, with a visible deadline and **Cancel deletion** button. Cancellation is available before the deadline and leaves the series archived. After the deadline, deletion cannot be cancelled or the series restored.
- **Cooldown:** **Danger zone → Bulk post deletion cooldown (days)** defaults to 7 days, accepts 1–30 days, and cannot be disabled. Changing it affects new requests only. Archiving alone never schedules deletion.
- **Progress and failures:** cleanup runs in small batches on the app scheduler and may take several hours after it starts, particularly for old installations. It discovers historical records across all supported months, including future posts published early. Keep the app installed until completion. Refresh Archived series to check progress. Failures remain visible with **Retry remaining deletion**; already deleted posts cannot be restored. Pending or uncertain publications must be resolved through recovery before bulk post deletion can finish. Once all work succeeds, the series disappears.

Deleting Reddit posts does **not** delete the comments underneath them. Bulk deletion uses the app's publication records; it does not search for or delete unrelated community posts. Series deletion clears its older configuration snapshots and recovery entries as well as its current data. New configuration audit entries record an action and actor without duplicating all series content.

### Personal-data deletion requests

An Everything-permissions moderator can select the bottom-right **Personal-data deletion** link in the full dashboard for a verified legal privacy request, such as a GDPR erasure request. Enter the Reddit username and choose **Check impact** first. The app counts recorded Check-In Crew posts that may need to be checked, then requires `DELETE` before the irreversible cleanup can begin. This count is an upper bound: only posts whose current body actually contains the requested `u/username` credit are edited.

It removes that account from maintainer access, host rosters, saved host-related edits, configuration audit entries, recovery records and publication actors. It also scans the recorded posts and replaces matching host credits with `[deleted]`, leaving other hosts and the post itself in place. A long-running account can require many historic Reddit post edits.

The request runs in the scheduler in small batches. Its progress is visible in the dashboard; if a Reddit post cannot be edited, the request stops with the reason and a moderator can choose **Retry cleanup**. The username is retained only while the cleanup job is active, then the job record is removed. The tool only changes posts recorded as created by Check-In Crew; it does not search Reddit or alter unrelated posts, comments, user flair, or a user’s Reddit account.

## Templates and individual edits

There are three levels of customisation:

1. **App settings** supply community defaults.
2. **Series templates** override those defaults when **Use default** is unchecked.
3. **Preview/edit** overrides the title or body of one future occurrence.

Changing a default affects upcoming posts still using it. Explicit custom values stay custom. Restore-default controls remove series overrides; **Reset to series defaults** removes an individual post's overrides. Published Reddit posts are not edited by these controls.

For a special post, select **Preview/edit**, uncheck **Use series default title** or **Use series default body**, and edit. **Update preview** shows the draft. **Save for this post** saves without publishing. A **Custom** badge marks edited occurrences.

Editing closes at the scheduled time or when publication starts. Past posts have a read-only **Preview** action. If another person changes the configuration while you edit, refresh or reopen the editor before saving.

### Shortcodes

Use single braces as shown below. Title editors provide buttons to insert supported shortcodes.

| Shortcode          | Meaning                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `{series}`         | Series display name.                                                                                       |
| `{frequency}`      | Daily, Weekly or Recurring, according to the simple series' pattern.                                       |
| `{weekday}`        | Full weekday name, such as Monday.                                                                         |
| `{date}`           | Scheduled date in YYYY-MM-DD format.                                                                       |
| `{time}`           | Occurrence's local posting time; useful in hourly titles.                                                  |
| `{day}`            | Day number within the calendar month.                                                                      |
| `{month}`          | Month and year, such as September 2026.                                                                    |
| `{host_credit_monthly}` | Formatted monthly-series credit; use in monthly post bodies.                                         |
| `{host_credit_simple}` | Formatted simple-series credit; it is blank until that series enables host credit.                    |
| `{community_note}` | Current community note from app settings; use in bodies.                                                   |
| `{signup_link}`    | Link to the month's recorded signup post, where available; intended for monthly bodies.                    |
| `{previous_link}`  | Link to the previous calendar day's recorded daily check-in, where available; intended for monthly bodies. |

For example: `Weekly {series} — {weekday} {date}`. Use `{weekday}` for Monday or Tuesday; `{day}` gives a number. Link shortcodes are not general navigation between arbitrary recurring occurrences.

Host credits, community notes and available links are filled in at posting time, including in customised bodies that retain those shortcodes.

## App settings

| Section                    | Contents                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| **Getting started**        | Overview and directions to the dashboard.                                                         |
| **General**                | Manual posting, optional app footer, community note and hourly scheduling switch.                 |
| **Hosts**                  | Default host credit format.                                                                       |
| **Monthly series**         | Separate title/body defaults for start, daily check-in and finish posts.                          |
| **Simple recurring posts** | Separate Daily, Weekly and Other title defaults, a shared body default and upcoming-window sizes. |
| **Danger zone**            | Maintainer permission for individual post deletion and the bulk post deletion cooldown.           |
| **Community tools**        | Enable the calculator (off by default) and Set flair (on by default).                             |

**Default community note** supplies text wherever `{community_note}` appears. Leave it blank to omit the message everywhere, or remove the shortcode from a particular body. **Show app footer** controls the optional “Scheduled with Check-In Crew.” line.

## Highlighting posts

Moderators can choose **Not stickied**, **Sticky slot 1** or **Sticky slot 2**. Monthly series have separate choices for start, daily and finish posts; simple series have one choice. All start as **Not stickied**.

Sticky slots are shared across the subreddit. A later post targeting an occupied slot can replace its existing sticky. There is currently no separate Community Highlights/Focus placement option.

## Manual posting and history

Enable **Allow Post now (testing or early publishing)** in app settings to show **Post now** beside eligible unposted occurrences. After confirmation, it creates a real Reddit post immediately using that occurrence's date and saved content, even while paused. The occurrence is marked as posted so the scheduler will not post it again.

Turning manual posting off hides and disables that action. Automatic posting is controlled separately by pause/resume. Manual posting is off by default.

History records status, links, timestamps and whether the scheduler or a Reddit user initiated posting. **Scheduled** means a future occurrence; it does not override a paused series. **Not posted** means a past occurrence without a publication record. **Pending** or **Uncertain** means publication needs checking before a retry.

Check Reddit first if a publication is pending or uncertain. The native menu includes **Fix a missing publication record** for moderators after ten minutes. Choose a month and then the exact attempt, labelled with date, time, timezone and post kind. This distinguishes hourly occurrences and retains access to attempts from older schedules. Use this when a post exists on Reddit but the dashboard or history still shows its attempt as pending or uncertain. Select **The post exists** and paste its Reddit post link to mark it as posted without publishing again. Standard Reddit post URLs and redd.it links are supported; for a shared /s/ link, open the post in a browser and copy its address. If no post was created, explicitly select **I checked; no post was created** and leave the link blank to clear that attempt. Clearing does not publish a retry or unarchive a series.

## Data, support and current limits

Check-In Crew stores series settings, templates, individual edits, maintainer IDs/usernames, host selections, schedule history, publication records and configuration audit history in Reddit's storage for the app installation. Temporary management forms expire after 15 minutes.

It does not store participants' goals or weights in its database or collect comment contents or private messages. Calculator inputs remain on-device. If a member explicitly applies a flair containing personal details, the selected fields pass through the server to Reddit as described above. The app also reads that member’s existing public flair and checks public account and moderation information needed for access, flair and host management. It has no external service integration.

Revoking access does not erase existing audit records or credits in published posts. Use the personal-data deletion process above for a verified request to remove them. Archiving preserves data and is reversible; it is not deletion. Permanent post and series deletion are described above. The scheduler checks Reddit accounts already referenced by maintainer or host records. A missing account is treated as unconfirmed until three checks have passed over at least 24 hours; API errors and rate limits do not count as deletion. After confirmation, the app removes the account from active access and host assignments only. It does not edit historic posts or erase stored identity records automatically. The full personal-data deletion process, including historic credit edits, requires an explicit moderator request.

This is a private test build. Use the full dashboard for posts and series management; the native hub provides access management, publication history, recovery and emergency pausing. Report problems to the installing community's moderators with the series name, date/time and visible error. Never include passwords or authentication tokens.

## Development

Requires Node.js 24 or later. The project uses Devvit 0.14.4; the configured test community is `r/loseit_test`.

| Command                  | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `npm.cmd run dev`        | Start the configured playtest.                                                |
| `npm.cmd run test:types` | Check TypeScript.                                                             |
| `npm.cmd run test:unit`  | Run calendar, access, editing, scheduling and publication tests.              |
| `npm.cmd run lint`       | Check code style and common errors.                                           |
| `npm.cmd run build`      | Build locally.                                                                |
| `npm.cmd run deploy`     | Check types/lint and upload a private build. Run unit tests separately first. |

The `.cmd` form works in Windows PowerShell without changing script execution policy. Other shells can use `npm`. README changes reach a version's About content on the next upload; the short listing description is managed separately in Reddit's Developer Portal. Uploading a private build and installing it in a community are separate steps.
