import type { Answer, Answers, DecisionRequest, Policy } from "../decision";
import { choiceAnswer, noulAnswer, uniformScoreAnswer } from "./baseline";

/** Always waits: the floor every other policy is compared against. */
export class IdlePolicy implements Policy {
  readonly name = "idle";

  async decide(req: DecisionRequest): Promise<Answers> {
    const answers: Answers = {};
    for (const [id, q] of Object.entries(req.questions)) {
      let a: Answer;
      if (q.type === "noul") {
        a = noulAnswer(0.5);
      } else if (q.type === "score") {
        a = uniformScoreAnswer(q.criteria);
      } else {
        const pick = id === "action" ? "wait" : "water";
        const labels = Object.keys(q.criteria);
        const target = labels.includes(pick) ? pick : labels[0];
        a = choiceAnswer(Object.fromEntries(labels.map((l) => [l, l === target ? 1 : 0])));
      }
      answers[id] = a;
    }
    return answers;
  }
}
