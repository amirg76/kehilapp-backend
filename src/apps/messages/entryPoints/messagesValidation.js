import { celebrate, Joi } from 'celebrate';
import { messageConstants } from '../../../config/validationConstants.js';

export const getMessagesValidation = celebrate({
  query: Joi.object().keys({
    searchTerm: Joi.string().allow(''),
    categoryId: Joi.string().allow(''),
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
    // text: Joi.string().min(messageConstants.textMaxLength),
  }),
});

export const deleteMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
