export const categoryConstants = {
  titleMinLength: 1,
  titleMaxLength: 15,
};

export const messageConstants = {
  titleMinLength: 2,
  titleMaxLength: 25,
  textMaxLength: 1500,
};

// How soon a reader has to act on a message. Kept here because four places need
// the same list — the Mongoose enum, the create and update schemas, and the
// classifier's output schema — and a fourth copy written by hand is a list that
// drifts: adding a level would then be accepted by Joi and refused by the model,
// or suggested by the model and refused by the model layer, depending on which
// copy was missed.
export const messageUrgencyLevels = ['routine', 'important', 'urgent'];
