import { celebrate, Joi, Segments } from 'celebrate';

export const loginValidation = celebrate({
  [Segments.BODY]: Joi.object().keys({
    email: Joi.string().email().required(),
    // Only a length floor here. Strength rules belong at registration, not at
    // login, where rejecting an existing password would just lock people out.
    password: Joi.string().min(8).max(128).required(),
  }),
});

export const registerValidation = celebrate({
  [Segments.BODY]: Joi.object().keys({
    email: Joi.string().email().required(),
    // Minimum-8 floor and a sane ceiling (bcrypt only reads the first 72 bytes,
    // so 128 is plenty and rejects absurdly large inputs early).
    password: Joi.string().min(8).max(128).required(),
    // Display name is optional; the controller derives one from the email when
    // it is absent.
    name: Joi.string().max(120).optional(),
  }),
});

export const verifyEmailValidation = celebrate({
  [Segments.BODY]: Joi.object().keys({
    token: Joi.string().required(),
  }),
});

export const resendVerificationValidation = celebrate({
  [Segments.BODY]: Joi.object().keys({
    email: Joi.string().email().required(),
  }),
});
