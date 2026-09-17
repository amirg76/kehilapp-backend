import { celebrate, Joi } from 'celebrate';

export const getUserByIdValidation = celebrate({
  params: Joi.object().keys({
    userId: Joi.string().required(),
  }),
});

// Approve/revoke carry no body — the verb is in the route, the subject in the
// param. Same shape as the read above.
export const approvalValidation = celebrate({
  params: Joi.object().keys({
    userId: Joi.string().required(),
  }),
});

// Changing a role DOES carry a body, and the set of roles is closed: `valid`
// mirrors the enum on the user schema, so an unknown role is a 400 at the door
// rather than a document that validates nowhere. Required, with no default — a
// role change has to be asked for explicitly, never inferred from an empty body.
export const roleChangeValidation = celebrate({
  params: Joi.object().keys({
    userId: Joi.string().required(),
  }),
  body: Joi.object().keys({
    role: Joi.string().valid('member', 'admin').required(),
  }),
});
