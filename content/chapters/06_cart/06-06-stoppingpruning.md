---
title: "Chapter 06.06: Stopping Criteria & Pruning"
weight: 6006
quizdown: true
---
The recursive partitioning procedure used to grow a CART usually leads to problems such as exponential growth of computations, overfitting, and the horizon effect. To deal with these problems, we can use stopping criteria and pruning. In this section, we explain the basis of these two solutions.

<!--more-->

### Lecture video

{{< video id="8CSGRjM8E0g" >}}

<iframe width="560" height="315" src="https://www.youtube.com/embed/8CSGRjM8E0g?si=5Ms3XDe8zZba26Vb" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay = "0"; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/slides-pdf/slides-cart-stoppingpruning.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] Pruning means cutting back the tree.
- [x] Pruning means that the tree becomes less complex.
- [ ] A tree with one observation per leaf node should have good generalization performance.

{{< /quizdown >}}
