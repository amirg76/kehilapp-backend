import { celebrate, Joi } from 'celebrate';
import { messageConstants, messageUrgencyLevels } from '../../../config/validationConstants.js';

export const getMessagesValidation = celebrate({
  query: Joi.object().keys({
    // Length cap defends the regex search: even escaped, a multi-kilobyte
    // pattern is work the database should never be asked to do.
    searchTerm: Joi.string().max(200).allow(''),
    categoryId: Joi.string().allow(''),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
  }),
});

export const getMessageByIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const createMessageValidation = celebrate({
  body: Joi.object().keys({
    categoryId: Joi.string().required(),
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    text: Joi.string().allow('').max(messageConstants.textMaxLength).optional(),
    // Joi only checks the value is a known tier. WHO may ask for 'members' is a
    // role question, and Joi cannot see req.role — the controller decides.
    visibility: Joi.string().valid('public', 'members').optional(),
    // Same division of labour as visibility: Joi checks the value is a known
    // level, the controller checks WHO is allowed to ask for a non-default one.
    urgency: Joi.string()
      .valid(...messageUrgencyLevels)
      .optional(),
    file: Joi.optional(),
  }),
});

export const updateMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    categoryId: Joi.string().required(),
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    // Mirrors createMessageValidation — the controller reads req.body.text, so
    // the update schema must permit it or every edit with a body 400s.
    text: Joi.string().allow('').max(messageConstants.textMaxLength).optional(),
    // Same as create: value check here, role check in the controller.
    visibility: Joi.string().valid('public', 'members').optional(),
    urgency: Joi.string()
      .valid(...messageUrgencyLevels)
      .optional(),
    file: Joi.optional(),
  }),
});

export const deleteMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

/**
 * The message the admin wants a suggestion for.
 *
 * Deliberately the same field rules as createMessageValidation, because this is
 * the same text on its way to the same create call — a draft the endpoint could
 * accept here and then refuse on save is a worse experience than refusing it
 * once, at the point the admin is still typing. It is also the cheaper refusal:
 * a body that could never be stored must not reach a billed API call.
 *
 * No categoryId: choosing it is the whole job.
 */
export const classifyMessageValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    text: Joi.string().allow('').max(messageConstants.textMaxLength).optional(),
  }),
});
