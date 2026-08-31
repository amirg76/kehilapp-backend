import { celebrate, Joi } from 'celebrate';
import { messageConstants } from '../../../config/validationConstants.js';

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
    text: Joi.string().allow('').optional(),
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
    text: Joi.string().allow('').optional(),
    file: Joi.optional(),
  }),
});

export const deleteMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
