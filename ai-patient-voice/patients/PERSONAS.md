# Patient personas

Each persona is a separate ElevenLabs agent (`patients.py`). All of them follow Mary's design:

- the patient never volunteers the hidden facts;
- they come out one at a time, only when the trainee asks a specific question;
- one tracked level changes with the trainee's style, one step per answer, so good and bad technique show up within a few turns;
- the hidden facts map onto standard diagnostic criteria, so a trainee who asks the right questions can reach a working hypothesis.

## Overview

| Key | Patient | 3D avatar (`?patient=`) | Situation (`src/cases.js`) | Clinical picture | Big Five (O C E A N) | What the trainee practises |
|---|---|---|---|---|---|---|
| `mary` | Mary Keller, 34, event manager | `young-woman` (avaturn) | `distracted` (exists) | Mild alcohol use disorder, minimised | avg, low, **high**, high, avg | Structuring: steering a talkative patient back to the question |
| `ryan` | Ryan Fischer, 28, warehouse shift supervisor | `young-man` (avatarsdk) | `aggressive` (exists) | Depressive episode with irritability and anger (externalising), sent by employer | low, avg, avg, **low**, **high** | De-escalation, autonomy support, suicide risk screening |
| `sophie` | Sophie Lang, 26, biology master's student | `young-woman` (avaturn) | `anxious` (new, below) | Social anxiety disorder | avg, high, **low**, high, **high** | Pacing, warmth, open questions, not spotlighting her anxiety |
| `tom` | Tom Becker, 33, former carpenter, paraplegic | `man-wheelchair` (avatarsdk + wheelchair) | `withdrawn` (new, below) | Depressive episode after spinal cord injury | low, high, **low**, avg, high | Person-first attitude, giving space, reflecting feelings, suicide risk screening |

The Big Five column is the profile the voice prompt is written for. Today the landing page only offers high extraversion, so that column matches the app for Mary only.

## Ryan Fischer: irritable, sent by his employer

**Clinical picture.**
- His hidden facts cover 8 of the 9 DSM-5 major depressive episode criteria: low mood ("flat", "grey"), loss of interest (bike, games nights), early-morning waking, fatigue, poor concentration, feeling like a failure, weight loss, and passive thoughts of death. Psychomotor change is the one missing.
- The symptoms have lasted 3 to 5 months.
- This is a moderate episode with passive suicidal ideation and no plan or intent.
- Alcohol use has risen to 2 to 3 beers most evenings, to help him sleep.

**Why he presents with anger.**
- Men with depression report anger, irritability, substance use and risk-taking more often than women (Martin et al., 2013).
- The Male Depression Risk Scale was built to capture this externalising pattern (Rice et al., 2013).
- Men's help-seeking is shaped by self-reliance norms, which explains "Men in my family don't talk about this stuff" (Addis & Mahalik, 2003).

**Trainee-dependent behaviour.**
- His irritation level follows psychological reactance theory: pressure on a person's freedom raises resistance (Brehm, 1966). Advice, labels, lecturing and pushing after he says "no" therefore make him more irritated.
- Autonomy support, permission-asking, accurate reflection and not arguing make him less irritated. These are core motivational interviewing responses to discord (Miller & Rollnick, 2013).
- He starts in precontemplation: he does not see a problem and is there because of outside pressure (Prochaska & DiClemente, 1983).

**Suicide screening.**
- Passive ideation only comes out when the question is asked directly and calmly.
- If the trainee reacts with alarm, he takes it back ("Forget I said anything"). This tests a calm, structured follow-up on plan, intent and reasons for living.

**Body language.** The existing `aggressive` situation fits him unchanged: he stares, sits with arms crossed, is angry at 0.65 and has a lot of head motion.

## Sophie Lang: socially anxious

**Clinical picture.** Her hidden facts meet the DSM-5 social anxiety disorder criteria:
- She fears scrutiny in social and performance situations.
- Her core fear is that others will see her anxiety and judge her.
- She avoids these situations or endures them with distress.
- It has lasted much longer than 6 months.
- It impairs her: her thesis is a semester behind, and she turned down a job.

She has never had suicidal thoughts and no panic attacks out of the blue, which rules out panic disorder.

**Onset.** Her onset at about 13 matches the typical age of onset for social phobia (median 13 years; Kessler et al., 2005).

**In-session behaviour.** It follows the cognitive model of social anxiety (Clark & Wells, 1995; Rapee & Heimberg, 1997):
- Self-focused attention: "Sorry, I go red so easily."
- Fear of negative evaluation: "Is that the right answer?"
- Safety behaviours: rehearsing sentences, scripts for phone calls, a scarf to hide blushing, holding her cup with both hands, notes prepared for the session.
- Post-event rumination: replaying conversations at night.
- She avoids eye contact, which is typical of social anxiety disorder (Schneier et al., 2011).

**Trainee-dependent behaviour.**
- Things that increase the sense of being scrutinised raise her anxiety level: checklist-style closed questions, being put on the spot, comments on her blushing, impatience.
- Predictability, normalising, a slow pace and open questions lower it.

**Suggested situation** for `SITUATIONS` in `src/cases.js`:

```js
{
  key: 'anxious',
  label: 'Socially anxious',
  blurb: 'Quiet, polite and nervous. Avoids eye contact, gives short answers and apologises. Train pacing, warmth and open questions.',
  enabled: true,
  profile: 'Sophie Lang, 26, biology master\'s student. Social anxiety: afraid of being judged, blushes, gives short hedged answers, apologises and asks for reassurance. Looks down and away, hands clasped, fidgets. Calms down with warmth, a slow pace and normalising; tenses up with rapid closed questions, impatience or remarks about her blushing.',
  body: {
    description: 'socially anxious: avoids eye contact, hands clasped, fidgets, blinks and breathes a bit faster',
    ranges: { gazeStudent: { min: 0.05, max: 0.45 }, fidget: { min: 0.35, max: 0.9 }, blink: { min: 1.1, max: 1.8 }, breath: { min: 1.0, max: 1.5 } },
    variability: 0.3,
    default_emotion: 'anxious',
    default_intensity: 0.55,
    arms: 'clasped'
  }
}
```

## Tom Becker: withdrawn after a spinal cord injury

**Clinical picture.**
- Four months of low mood, loss of interest, changed sleep, low energy, feelings of uselessness and guilt, and mild concentration problems: at least 5 DSM-5 depressive episode criteria.
- He had thoughts of death early in hospital but none now.
- Depression affects about 22% of people after spinal cord injury (Williams & Murray, 2015), so his picture is common and not a "natural" reaction to be waved through.

**Why the chair is not the topic.**
- Tom has adapted to the wheelchair practically. What weighs on him is losing his role, being cut off from his work mates, and feeling like a burden to Anna.
- Perceived burdensomeness and thwarted belonging are the two key risk factors in the interpersonal theory of suicide (Joiner, 2005; Van Orden et al., 2010). Exploring them is part of a good risk assessment.

**Disability bias.**
- Two documented biases trigger his dry pushback:
  - "spread": assuming the disability explains everything about the person (Wright, 1983);
  - pity or "confined to a wheelchair" language.
- The prompt tests both. Therapists are advised to treat the disability as one part of the person's context, not the presenting problem (Olkin, 1999).

**Trainee-dependent behaviour.**
- His openness rises with accurate reflection and with room after heavy questions.
- It falls with advice, cheerleading or rushing on. This trains tolerating silence and reflecting feelings with an emotionally restrained, self-reliant patient.

**Suggested situation.** Foot tapping and knee bouncing are pinned at 0, because a complete T11 injury means he cannot tap his foot or bounce his knee. The conversation states (for example `uneasy`, `footTap: 0.35`) are clamped by these ranges.

```js
{
  key: 'withdrawn',
  label: 'Withdrawn',
  blurb: 'Quiet, stoic and closed. Short factual answers, dry humour, little emotion. Train giving space and reflecting feelings.',
  enabled: true,
  profile: 'Tom Becker, 33, former carpenter. Complete spinal cord injury (T11) 18 months ago; uses a manual wheelchair and cannot move his legs. Quiet, self-reliant, dry humour, shows little emotion. Low mood, feels useless and a burden to his partner Anna. Bristles at pity or assumptions about his disability; opens up slowly when given space and accurate reflections.',
  body: {
    description: 'withdrawn and stoic: still, little head movement, looks down or away when feelings come up; legs never move',
    ranges: { footTap: { min: 0, max: 0 }, legBounce: { min: 0, max: 0 }, headMotion: { min: 0, max: 0.35 }, shift: { min: 0, max: 0.2 }, gazeStudent: { min: 0.2, max: 0.65 }, fidget: { min: 0, max: 0.3 } },
    variability: 0.15,
    default_emotion: 'withdrawn',
    default_intensity: 0.45
  }
}
```

## Using them in the 3D app (not wired yet)

The 3D app still uses one agent (`AGENT_ID`, Mary) for every avatar and situation. Four changes would let each persona speak through its own avatar:

1. **Server.** `server/elevenlabs.js` would map a persona key to its agent ID (`AGENT_ID_RYAN`, ...) in `/api/voice/agent-session`.
2. **Client.** `src/conversation.js` would send that key with the session request.
3. **Situations.** `src/cases.js` would get the two situations above, plus a way to tie a persona to a patient and situation.
4. **Director.** The live director prompt (`LIVE_DIRECTOR_SYSTEM` in `shared/agent-tools.js`) and `offlineState()` in `src/agent.js` would need to stop assuming Mary. They currently mention drinking, parties and her phone, and always say "she".

Until then, talk to the new patients with `python talk.py --patient <key>`.

## References

- Addis, M. E., & Mahalik, J. R. (2003). Men, masculinity, and the contexts of help seeking. *American Psychologist, 58*(1), 5–14.
- American Psychiatric Association. (2022). *Diagnostic and statistical manual of mental disorders* (5th ed., text rev.).
- Brehm, J. W. (1966). *A theory of psychological reactance*. Academic Press.
- Clark, D. M., & Wells, A. (1995). A cognitive model of social phobia. In R. G. Heimberg et al. (Eds.), *Social phobia: Diagnosis, assessment, and treatment* (pp. 69–93). Guilford.
- Joiner, T. (2005). *Why people die by suicide*. Harvard University Press.
- Kessler, R. C., et al. (2005). Lifetime prevalence and age-of-onset distributions of DSM-IV disorders in the National Comorbidity Survey Replication. *Archives of General Psychiatry, 62*(6), 593–602.
- Martin, L. A., Neighbors, H. W., & Griffith, D. M. (2013). The experience of symptoms of depression in men vs women. *JAMA Psychiatry, 70*(10), 1100–1106.
- Miller, W. R., & Rollnick, S. (2013). *Motivational interviewing: Helping people change* (3rd ed.). Guilford.
- Olkin, R. (1999). *What psychotherapists should know about disability*. Guilford.
- Prochaska, J. O., & DiClemente, C. C. (1983). Stages and processes of self-change of smoking. *Journal of Consulting and Clinical Psychology, 51*(3), 390–395.
- Rapee, R. M., & Heimberg, R. G. (1997). A cognitive-behavioral model of anxiety in social phobia. *Behaviour Research and Therapy, 35*(8), 741–756.
- Rice, S. M., et al. (2013). The Male Depression Risk Scale: Development and psychometric evaluation. *Journal of Affective Disorders, 151*(3), 950–958.
- Schneier, F. R., et al. (2011). Fear and avoidance of eye contact in social anxiety disorder. *Comprehensive Psychiatry, 52*(1), 81–87.
- Van Orden, K. A., et al. (2010). The interpersonal theory of suicide. *Psychological Review, 117*(2), 575–600.
- Williams, R., & Murray, A. (2015). Prevalence of depression after spinal cord injury: A meta-analysis. *Archives of Physical Medicine and Rehabilitation, 96*(1), 133–140.
- Wright, B. A. (1983). *Physical disability: A psychosocial approach* (2nd ed.). Harper & Row.
