const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { toJSON, paginate } = require('./plugins');

const OpenTraderScriptSchema = new Schema(
  {
    traderId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Trader"
    },
    scriptId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'AdviserScript'
    },
    advisorId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Advisor'
    },
    otherInfo: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }, versionKey: false }
);

OpenTraderScriptSchema.plugin(toJSON);

const OpenTraderScripts = mongoose.model(
  'OpenTraderScripts',
  OpenTraderScriptSchema,
  'OpenTraderScripts'
);

module.exports = OpenTraderScripts;
