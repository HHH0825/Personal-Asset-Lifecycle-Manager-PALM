const VARIANTS = ['add', 'collection', 'identity', 'purchase', 'memories', 'login', 'save']
Component({
  properties: { variant: { type: String, value: 'identity' }, text: String, number: String },
  data: { art: 'identity', imageFailed: false },
  observers: {
    variant(value) { this.setData({ art: VARIANTS.includes(value) ? value : 'identity', imageFailed: false }) }
  },
  methods: { imageError() { this.setData({ imageFailed: true }) } }
})
