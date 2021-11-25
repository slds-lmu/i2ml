---
title: "Chapter 06.04: Computational Aspects of Finding Splits"
weight: 6004
quizdown: true
---
In this section, we explain the computational aspects of the node-splitting procedure, especially for nominal features. In addition, we illustrate how to deal with missing values.

<!--more-->

### Lecture video

{{< video id="RujQ_xP-NFA" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/slides-pdf/slides-cart-splitcomputation.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] To find optimal splits, one iterates over all features, and for each feature over all possible split points.
- [ ] To find optimal splits, we use the one that splits the data approximately in half in each step.
- [x] To find optimal splits, we evaluate the possible splits only on the data that ended up in the parent node we are trying to split.
- [x] The optimal split results in the lowest sum of empirical risks in the child nodes.
- [ ] Monotone transformations of several features will change the structure of the tree.
- [x] The CART algorithm cannot go on training if every node contains exactly one observation.

{{< /quizdown >}}
