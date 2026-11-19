# Project discovery and first-run interview

The developer can speak for an hour, paste a detailed plan, or answer a single question at a time. Both entry modes collect the same facts. **Talk it through** shows all five prompts together with examples collapsed. Examples open individually or together. **Go question by question** shows the current example expanded. The bottom text and dictation box stays available in both modes and during the build.

1. What would you like to build?
2. Who will use it first, and what is hard for them today?
3. Walk through one successful use. Who acts, what do they do and what happens at the end?
4. What should the first demo prove? What can wait?
5. Which product, platform or technology decisions are fixed, and where would you like a recommendation?

A successful workflow usually needs just an actor, an action and a result. “Staff order through a link and the kitchen sees totals by dish” supplies all three. It leaves the cutoff time, edit permissions and delivery channel available for specific follow-ups. An answer to question three can also settle part of question four. The reviewer checks the whole conversation before asking someone to repeat an answer. [Examples and opening rubric](opening-prompts.md)

## Submitting a long answer

Speech becomes local text in the composer while the user talks; there is no live model graph during dictation. Only an explicit submit commits a turn, and the canvas updates once afterwards with the changes highlighted. Silence, a long pause (the mic switches itself off after a minute and keeps the draft), autosave or a closed laptop never starts questions or holds work. Uncertain numbers, times and names are underlined locally before Send and echoed in the change summary after it. [Interactive architecture](interactive-architecture.md#dictation-flow) Save draft progress separately so a resumed interview can recover it. For a long turn, extract in bounded chunks that reference offsets into the same submitted text, then reconcile corrections and withdrawals across chunks before the first state update. Keep the current question and options fixed from input start until submission.

“Maybe add printing … actually, scrap printing” contributes no printing feature. “Maybe add printing” on its own enters the current release. “Add printing after launch” enters the later list. Let the user move a feature to later from the change summary. When the user clearly replaces a previous decision, retain the old fact for history and invalidate its dependents. If two readings remain, ask after submission. Show uncertain dictated names, times or amounts that affect behavior. Keep transcript offsets and recognition confidence when available. Replaying raw audio requires that it was collected and retained under the project’s recording preference.

## From the first five to the next five

The opening reviewer checks whether the product, user, workflow, demo and constraints are clear enough to identify useful next questions. “Choose a free local database for the demo” delegates one bounded choice. “I don’t know” earns a recommendation and a concrete way to decide. An opening can finish while a technology choice is still pending. [Three versioned prompt contracts](opening-prompts.md)

After that, code selects up to five questions per batch from the shared and relevant domain catalogs. A small feature can use two or three. The resolver answers what it can from validated evidence before sending the remaining questions to the user. If the whole request is already detailed, several internal batches may close with zero follow-ups. One question may cover multiple criteria. “Send email” settles the channel while its recipient stays open. Ask who receives it in the same batch and retain the other answers. If the decision is reopened later, it can return to the next eligible batch.

If the user says “I don’t understand,” rephrase the same decision with their example and keep its question ID. Several planners may need the same answer. One question arbiter shares a focused card and sends the result to all subscribers. A late reply to a retired question is reconciled as a possible new fact against the active revision. It cannot revive obsolete work by itself. [Single-chat routing](routing-design.md)

## When planning can begin

The app shows all decisions settled, readiness for the current planning scope, any open critical decisions, and items explicitly postponed to a named milestone. A feature inherits the project decisions it relies on. For example, an order-edit feature that depends on a role model cannot reach readiness while editor permissions remain unknown. A user can explicitly leave the email provider for the delivery adapter task if its stable delivery contract lets the rest proceed.

Before declaring readiness, the planner checks domain applicability, existing code constraints, critical failure paths and real acceptance examples. Constructing the architecture can expose another missing link. The owner reopens that specific criterion and asks once through the same queue if evidence is missing. When the applicable planning snapshot reaches 100%, critical blockers are zero and architecture checks clear, the kernel publishes the plan and shows the plan preview. The first build starts on **Start build**; later small revisions can start automatically ([planning and crew](planning-and-crew.md#plan-preview)). Every batch offers **Accept all recommended** and **Autopilot** ([discovery depth](discovery-depth-and-catalog.md)). For an existing repo the opening adapts ([brownfield discovery](brownfield-discovery.md)). A future milestone decision still blocks its consuming tasks. [Readiness formula and worked cases](architecture-ideas.md) · [Editable Mermaid](adaptive-question-selection.mmd) · [Diagram](adaptive-question-selection.svg)
