import { celebrate, Joi } from 'celebrate';
import { categoryConstants } from '../../../config/validationConstants.js';

export const getCategoryByIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const createCategoryValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().required(),
    categoryColor: Joi.string().required(),
  }),
});

export const updateCategoryValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().min(categoryConstants.titleMinLength).max(categoryConstants.titleMaxLength).required(),
    managedBy: Joi.string().required(),
    categoryColor: Joi.string().required(),
  }),
});

export const deleteCategoryValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
