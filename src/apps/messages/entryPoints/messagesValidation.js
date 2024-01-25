import { celebrate, Joi } from 'celebrate';
import { messageConstants } from '../../../config/validationConstants.js';

export const getMessagesByCategoriesValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const searchMessagesValidation = celebrate({
  query: Joi.object().keys({
    searchTerm: Joi.string().required(),
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
    text: Joi.string().max(messageConstants.textMaxLength),
  }),
});

export const updateMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    categoryId: Joi.string().required(),
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    text: Joi.string().min(messageConstants.textMaxLength),
  }),
});

export const deleteMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
