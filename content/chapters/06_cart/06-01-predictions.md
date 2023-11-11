---
title: "Chapter 06.01: Predictions with CART"
weight: 6001
quizdown: true
---
Decision trees are an important type of machine learning model and come in two main types: classification and regression trees. In this section, we explain the general idea of CART and show how they recursively divide up the input space into ever smaller rectangular partitions.
Thus, we think of CART for now only as a predictor.

<!--more-->

### Lecture video

{{< video id="mouBj4qiHRs" >}}

<iframe width="560" height="315" src="https://www.youtube.com/embed/mouBj4qiHRs?si=8j28kFDwZSV2nASB" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay = "0"; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/slides-pdf/slides-cart-predictions.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] The prediction function defined by a CART divides the feature space into disjoint hyperrectangles.
- [x] The root node contains all data.
- [ ] The leaf node contains all data.
- [ ] Observations can end up in several leaf nodes at the same time.
- [x] The CART algorithm recursively splits nodes into child nodes.

{{< /quizdown >}}
